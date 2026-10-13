# 把本插件接入本机 DSH Desktop 的 web profile（Windows）。
#
# 为什么要改 patch 而不是装包：
#   DSH Desktop 启动的是 profile `web`，它的用户 patch 层在
#     %APPDATA%\dsh-desktop\harness\profiles\web\cordis.patch.yml
#   （该文件受 HMR 监视，新行插入后无需重启即可挂载）。patch 里的 name 既可以是
#   包名（走 profile\node_modules 解析），也可以是插件模块的绝对路径——本脚本默认
#   用后者：不装 pnpm 包、不碰 profile\package.json、不依赖 node_modules，因而
#   插件市场重写 package.json 时也不会把它清掉。
#
# 幂等策略：**先删净再追加**。脚本把 patch 文件切成顶层条目（`- ` 开头，含其缩进
# 续行与条目内注释），删掉所有提到本插件包名的条目，再在末尾追加一条。因此重复执行
# 不会产生第二条同名行（两条 active 行解析到同一包名会让客户端模块组合直接失败）。
#
# 用法：
#   pwsh -File install.ps1                 # 默认：绝对路径行（推荐）
#   pwsh -File install.ps1 -PnpmLink       # 备选：建联接 + 登记 link: 依赖 + 写包名行
#   pwsh -File install.ps1 -Uninstall      # 卸载（删条目、依赖行与联接）
#
# 改 JS 之后：改 client.js 刷新页面即可；改 index.js（host 半边）需要重启 DSH Desktop。

[CmdletBinding()]
param(
    # 默认 %APPDATA%\dsh-desktop\harness\profiles\web，可用本参数覆盖。
    [string]$ProfileDir,
    # PowerShell 变量名不区分大小写：开关不能叫 $Link，否则和下面的 $link 路径变量撞名。
    [switch]$PnpmLink,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$packageName = 'dsh-turn-meta-badge'
$source = $PSScriptRoot
$entry = Join-Path $source 'index.js'

if (-not $ProfileDir) {
    $harnessHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:APPDATA 'dsh-desktop\harness' }
    $ProfileDir = Join-Path $harnessHome 'profiles\web'
}

if (-not (Test-Path -LiteralPath $ProfileDir)) {
    throw "找不到 DSH web profile：$ProfileDir"
}

$nodeModules = Join-Path $ProfileDir 'node_modules'
$link = Join-Path $nodeModules $packageName
$manifestPath = Join-Path $ProfileDir 'package.json'
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'

# 条目里所有注释都缩进（属于该条目），这样"按条目删除"就能把它一并带走。
$rowName = if ($PnpmLink) { $packageName } else { ($entry -replace '\\', '/') }
$patchBlock = @"
- insert:
    # $packageName：每条助手回复右下角的「模型 · 思考深度 · 用量 · ¥金额」徽章。
    # 金额来自本机已装的 @kenz1117/dsh-ui-usage-billing 的 /api/billing/usage-stats（人民币元）；没装就自动少这一段。
    # 关掉金额 / 改轮询周期：在下一行前面加一行 config: { cost: false, pollMs: 60000 }
    - id: turn-meta-badge
      name: $rowName
"@

function Backup-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $backup = "$Path.bak-$packageName"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Host "已备份：$backup"
}

# 一个顶层条目 = 一行 `- ` 开头 + 它的缩进续行/条目内注释，直到下一个 `- ` 行（或文件末尾）。
$entryPattern = '(?ms)^- .*?(?=^- |\z)'

<#
.SYNOPSIS
  删除 patch 文本里所有提到本插件包名的顶层条目，以及本脚本过去写在条目外的遗留注释行。
#>
function Remove-PluginEntries([string]$Text) {
    $kept = New-Object System.Collections.Generic.List[string]
    $cursor = 0
    foreach ($match in [regex]::Matches($Text, $entryPattern)) {
        $gap = $Text.Substring($cursor, $match.Index - $cursor)
        if ($gap.Length -gt 0) { $kept.Add($gap) }
        if ($match.Value -notmatch [regex]::Escape($packageName)) { $kept.Add($match.Value) }
        $cursor = $match.Index + $match.Length
    }
    if ($cursor -lt $Text.Length) { $kept.Add($Text.Substring($cursor)) }

    $joined = ($kept -join '')
    # 0.1.x 版本的脚本把说明注释写在条目外面，重复执行会留下孤儿注释；按特征清掉。
    $lines = $joined -split "`r?`n" | Where-Object {
        -not ($_ -match '^#' -and $_ -match "(dsh-turn-meta-badge|dsh-ui-usage-billing|config: \{ cost)")
    }
    return (($lines -join "`n") -replace "(`r?`n){3,}", "`n`n").TrimEnd() + "`n"
}

<#
.SYNOPSIS
  统计 patch 文本里本插件的顶层条目数；用于写回前的自检。
#>
function Count-PluginEntries([string]$Text) {
    $count = 0
    foreach ($match in [regex]::Matches($Text, $entryPattern)) {
        if ($match.Value -match [regex]::Escape($packageName)) { $count += 1 }
    }
    return $count
}

if ($Uninstall) {
    if (Test-Path -LiteralPath $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.LinkType) {
            # 只删联接本身，绝不动目标目录（本仓库）。
            [System.IO.Directory]::Delete($link, $false)
            Write-Host "已移除联接：$link"
        }
        else {
            Write-Warning "路径存在但不是联接，未删除：$link"
        }
    }

    if (Test-Path -LiteralPath $manifestPath) {
        $text = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
        if ($text -match [regex]::Escape($packageName)) {
            Backup-File $manifestPath
            $lines = $text -split "`r?`n" | Where-Object { $_ -notmatch [regex]::Escape($packageName) }
            Set-Content -LiteralPath $manifestPath -Value (($lines -join "`n").TrimEnd() + "`n") -Encoding UTF8 -NoNewline
            Write-Host '已从 package.json 移除依赖行'
        }
    }

    if (Test-Path -LiteralPath $patchPath) {
        $patch = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8
        $before = Count-PluginEntries $patch
        if ($before -gt 0) {
            Backup-File $patchPath
            Set-Content -LiteralPath $patchPath -Value (Remove-PluginEntries $patch) -Encoding UTF8 -NoNewline
            Write-Host "已从 cordis.patch.yml 移除 $before 条 patch 条目"
        }
    }

    Write-Host '卸载完成。在 DSH Desktop 里刷新页面（或重启）生效。'
    return
}

if (-not (Test-Path -LiteralPath $entry)) {
    throw "插件入口不存在：$entry"
}

# 1) 可选：建联接 + 登记 link 依赖（-PnpmLink 模式）
if ($PnpmLink) {
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        throw "profile 缺少 node_modules：$nodeModules"
    }
    if (Test-Path -LiteralPath $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.LinkType) {
            Write-Host "联接已存在：$link -> $($item.Target)"
        }
        else {
            throw "路径已存在且不是联接，请先手工处理：$link"
        }
    }
    else {
        New-Item -ItemType Junction -Path $link -Target $source | Out-Null
        Write-Host "已建立联接：$link -> $source"
    }

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "profile 缺少 package.json：$manifestPath"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    if ($manifest -match [regex]::Escape($packageName)) {
        Write-Host 'package.json 已包含依赖行'
    }
    else {
        $anchor = '"dependencies": {'
        $index = $manifest.IndexOf($anchor)
        if ($index -lt 0) {
            throw "package.json 里找不到 $anchor，请手工添加依赖：`"$packageName`": `"link:$(($source -replace '\\','/'))`""
        }
        Backup-File $manifestPath
        $dependencyLine = '    "{0}": "link:{1}",' -f $packageName, ($source -replace '\\', '/')
        $insertAt = $index + $anchor.Length
        $updated = $manifest.Substring(0, $insertAt) + "`n" + $dependencyLine + $manifest.Substring($insertAt)
        Set-Content -LiteralPath $manifestPath -Value $updated -Encoding UTF8 -NoNewline
        Write-Host "已在 package.json 登记：$dependencyLine"
    }
}

# 2) 写 patch 条目：先删净旧的，再追加一条
if (-not (Test-Path -LiteralPath $patchPath)) {
    Set-Content -LiteralPath $patchPath -Value ($patchBlock + "`n") -Encoding UTF8
    Write-Host '已创建 cordis.patch.yml 并写入 patch 条目'
}
else {
    $patch = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8
    $before = Count-PluginEntries $patch
    Backup-File $patchPath
    $cleaned = Remove-PluginEntries $patch
    $updated = $cleaned.TrimEnd() + "`n`n" + $patchBlock + "`n"

    $after = Count-PluginEntries $updated
    if ($after -ne 1) {
        Copy-Item -LiteralPath "$patchPath.bak-$packageName" -Destination $patchPath -Force
        throw "自检失败：写回后本插件条目数为 $after（应为 1），已从备份还原 $patchPath"
    }

    Set-Content -LiteralPath $patchPath -Value $updated -Encoding UTF8 -NoNewline
    if ($before -gt 0) { Write-Host "已替换 cordis.patch.yml 中的 patch 条目（清理旧条目 $before 条）" }
    else { Write-Host '已在 cordis.patch.yml 追加 patch 条目' }
}

Write-Host ''
Write-Host "安装完成（row name: $rowName）。"
Write-Host 'profile patch 层受 HMR 监视，新行通常几秒内挂载；随后刷新页面（Ctrl+R）让会话载荷带上 turnMeta 投影。'
Write-Host '验证：每条助手回复右下角应出现「模型 · 思考深度 X · 用量 N tok · ¥金额」。'
