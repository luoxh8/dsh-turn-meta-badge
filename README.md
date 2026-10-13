# dsh-turn-meta-badge

在 DeepSeek Harness（DSH）Web GUI 的**每条助手回复右下角**显示这一轮实际使用的东西：

```
glm-5.3-flash · 思考深度 高 · 用量 2.2M tok · ¥0.103
```

所有数字**直接写在徽章上**，不依赖悬停；悬停只是附加的精确分桶。

鼠标悬停还能看到精确分桶与金额：

```
deepseek-official / deepseek-flash
思考深度: 高
未缓存输入: 3,221
缓存读取: 21,504
输出: 507
合计: 25,232
本轮费用: ¥0.103
本会话累计: ¥2.38
```

- 纯 UI 插件：不注册工具、不注入系统提示、不写任何模型可见事件，只读别人已经落盘的会话日志。
- 无需构建：`client.js` 就是浏览器直接加载的普通 JS。
- 中文 / 英文标签跟随 GUI 语言（`document.documentElement.lang`）。

## 数据从哪来

两个半边：

| 半边 | 文件 | 职责 |
|---|---|---|
| Host | `index.js` | 注册一个客户端可见的会话投影 `turnMeta`，把持久日志折成逐轮元数据 |
| Browser | `client.js` | 占位 `conversation.chat.turnTail` 槽位，右对齐渲染徽章 |

`turnMeta` 是 `@deepseek-ai/dsh-session-projection` 的普通投影单元，`stateVersion: 1`，按已提交事件同步折叠：

| 日志事件 | 折叠动作 |
|---|---|
| `request/header` | 记住当前请求配置（`provider` / `model` / `reasoningEffort`）——DSH 只在配置变化时记录它，所以「最后一条」就是该请求生效的配置 |
| `turn/start` | 为该轮建条目（建时即带上当前模型与思考深度，所以正在流式输出的轮也有值） |
| `assistant/message` / `assistant/attempt` | 记录该 step 的 `usage` 桶（`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` / `totalTokens`），模型取 `message.source.provider/model`（**这一步实际走的模型**，而不是会话当前选择） |
| `llm/retry-started` | 丢弃该 `(turn, step)` 的旧桶，重试替换而非累加 |
| 其他事件 | 原样返回同一引用（零下游开销） |

浏览器侧渲染时：

- **token 与金额以 billing 的逐轮数据为主**（轮询获取，与页面加载时机无关，因此不会因为"页面早于插件加载"而缺失）；
- 模型 / 思考深度来自 `turnMeta`（投影缺席时退化为会话当前的 `modelSelection`）；
- token 的兜底也是 `turnMeta`（billing 没有该轮行时）；
- 完全不认识这一轮时返回 `null`，不占位。

思考深度（`reasoningEffort`）在 DSH 里**没有逐消息字段**：`assistant/message` 只带 provider/model，档位只存在于 `request/header` 的 `config.reasoningEffort`。本插件用投影按事件顺序折叠，因此拿到的是**该轮请求真正生效的档位**，而轨迹视图里那个 idea 之外没有别的逐消息来源。

## 金额（¥）从哪来

DSH 本身没有客户端可读的逐轮花费，但本机已装的 `@kenz1117/dsh-ui-usage-billing` 提供了 loopback 路由 `GET /api/billing/usage-stats`，响应里的 `byTurn` 就是逐轮明细：

```json
{ "sessionId": "session-…", "turn": 2, "model": "flash",
  "input": 2087782, "output": 14013, "cacheHit": 2082304, "cacheMiss": 5478,
  "cost": 0.10317608, "startedAt": 1791888908616 }
```

`cost` 是**人民币元**，由那个插件按调用时刻的高峰/空闲档、缓存命中/未命中分别定价算出，比本插件自己维护一份价目表可靠，所以金额一律引用它：

- 装了 billing 插件 → 徽章尾部出现 `¥0.103`，悬停显示本轮费用与本会话累计；
- 没装 / 关掉 → 自动省略金额段，token 段不受影响（只在首次探测失败后停止轮询，不反复打无效请求）；
- 轮询周期默认 30 秒（隐藏标签页时跳过），当前会话的最近 200 轮内可匹配（billing 插件自己的 `TURN_ROW_LIMIT` 上限）；
- 订阅通道 / 免费模型的轮次 `cost` 为 `0`，徽章显示 `¥0` 而不是把它藏起来，所以"免费"和"没定价"能区分开。

在 patch 行里可以调：

```yaml
- insert:
    - id: turn-meta-badge
      name: D:/codex_proj/dev/projects/dsh-turn-meta-badge/index.js
      config: { cost: false, pollMs: 60000 }   # 关掉金额 / 改轮询周期
```

## 安装

目标：DSH Desktop 的 web profile（`%APPDATA%\dsh-desktop\harness\profiles\web`，可用 `DSH_HOME` / `-ProfileDir` 覆盖）。

```powershell
# 默认：往 profile 的 cordis.patch.yml 追加一条绝对路径的 insert 行
pwsh -File install.ps1

# 备选：pnpm 风格（建 node_modules 联接 + 在 profile\package.json 登记 link: 依赖 + 写包名行）
pwsh -File install.ps1 -PnpmLink

# 卸载（两种形式都会清掉：patch 块、依赖行、联接）
pwsh -File install.ps1 -Uninstall
```

默认的绝对路径形式不装 pnpm 包、不碰 `profile\package.json`，因此插件市场重写 `package.json` 时也不会把它清掉；代价是**插件目录挪位置后要重跑 install.ps1**（patch 里的路径会失效）。`-PnpmLink` 形式更"正规"，但 pnpm 安装动作可能清掉联接，需要重跑。

改前一律备份：`cordis.patch.yml.bak-dsh-turn-meta-badge`、`package.json.bak-dsh-turn-meta-badge`。

## 生效与迭代

1. profile 的 `cordis.patch.yml` 受 HMR 监视（Desktop 的 HMR 兜底只提供配置监视这一部分），**新行插入后不需要重启**：Loader 会挂载它，已打开的页面也会通过客户端 HMR 传输拿到这一行（实测：插件行出现、徽章当场渲染出模型与思考深度）。
2. **但投影数据要刷新一次页面（Ctrl+R）才到**：会话页里那份 `projections` 是页面加载时取的，页面早于插件存在时就没有 `turnMeta`。此时徽章走兜底路径——只显示模型 + 会话当前档位、没有 token/金额，悬停会明确写「未收到本轮用量：刷新一次页面即可载入 host 投影 turnMeta」。刷新后 token 与金额一起出现。
3. 之后修改 `client.js` 只要**刷新页面**（bundle 的 `rev` 变、启动图给新 URL）；改 `index.js`（host 半边）需要重启 DSH Desktop —— Desktop 没有模块热替换，只有配置文件监视。
4. 排查用：徽章上有 `data-turn-meta`（轮次号）与 `data-turn-meta-source`（`turn` / `header` / `session` / `none`）两个属性，能一眼看出数据落在哪条路径上。

## 验证

```powershell
# 单元测试：投影折叠（含真实会话日志回放）+ 浏览器半边离线渲染与成本解析
$env:DSH_SESSION_JSONL='<解压后的 session.jsonl>'   # 可选，加上就回放真实日志
node --test test/turn-meta.test.mjs test/client.test.mjs
```

真实日志回放会把投影结果与「独立数原始事件」逐轮对比：轮集合、每轮 `totalTokens`/`inputTokens`/`outputTokens`、每轮模型与思考深度都必须一致。

运行中的 GUI 也可以从启动图与 bundle 确认插件已被组合（loopback 资源路由免鉴权）：

```powershell
$html = (Invoke-WebRequest "http://127.0.0.1:43129/?token=<启动日志里的 token>").Content
[regex]::Match($html, '\{"id":"dsh-turn-meta-badge".{0,80}').Value   # 启动图里的行
(Invoke-WebRequest "http://127.0.0.1:43129/plugins/??dsh-turn-meta-badge/client.js&rev=<该行的 rev>").Content.Length
```

`dsh web: http://127.0.0.1:43129/?token=…` 这一行在 `%APPDATA%\dsh-desktop\logs\harness.log` 里。

## 已知限制

- **每轮一条，不是每个 assistant step 一条**：槽位 `conversation.chat.turnTail` 是"整轮收尾"位置，工具调用中途的 assistant step 没有独立页脚。这是 DSH 现有的唯一逐轮页脚扩展点。
- **只有正文回复才显示**：`turn-tail` 节点渲染在收尾助手消息之后；纯工具轮没有助手正文时不渲染徽章。
- **token 是这一轮所有 attempt 的合计**，与内置「本轮用量」弹窗口径一致（缓存/推理桶只有在每个 attempt 都报告时才给出，不编造 0）。
- **金额依赖第三方 billing 插件**（`@kenz1117/dsh-ui-usage-billing`）的路由与 `cost` 字段；它不在时就只有 token 段。金额按会话内轮次号匹配，超出租插件 200 行的旧轮次不显示。
- 徽章在复制/分支图标行的**上一行右对齐**：DSH 没有"图标行右侧"的公开槽位，`assistant-actions` 槽会被插到复制图标与分支图标之间（左侧）。
- 投影随会话全量日志增长（每轮几十字节）；这是 DSH 投影协议的共同约束（每个尾页携带每个 client-visible key）。

## 文件

```
index.js             host 半边：turnMeta 投影（无任何 import，纯函数折叠）
client.js            浏览器半边：__ModuleLoader__ 普通 JS bundle + billing 成本轮询
install.ps1          安装 / 卸载 / 备选联接模式
test/turn-meta.test.mjs   投影折叠自测 + 真实日志回放
test/client.test.mjs      浏览器半边离线自测（模块 id / 槽位 / 渲染文本 / 成本）
```

## 与 ai-bootstrap 的关系

本机的 profile patch（`profiles\web\cordis.patch.yml`）同时被 ai-bootstrap 的 `setup.ps1` 按 id 合并维护：它只替换同 id 的块、追加缺失的 insert 块、其余行一字不动，因此本插件写入的块（带 `# --- 每条助手回复右下角…` 标记）会原样保留。**不要**再把同一条 insert 行抄进 `config\dsh-profile-custom.patch.yml`：那会在下一次 setup 时追加出第二条同名行，两条 active 行解析到同一个包名会让客户端模块组合直接失败。

从模板恢复 profile 后，重跑本仓库的 `install.ps1` 即可。
