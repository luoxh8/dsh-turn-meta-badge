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
# 默认（绝对路径行，推荐）：
#   pwsh -File install.ps1
# 备选（pnpm 风格：建联接 + 在 profile\package.json 登记 link: 依赖 + 写包名行）：
#   pwsh -File install.ps1 -PnpmLink
# 卸载（两种形式都清）：
#   pwsh -File install.ps1 -Uninstall
#
# 修改 client.js / index.js 之后需要重启 DSH Desktop：已挂载行的 JS 不做热替换
# （Desktop 的 HMR 兜底只监视配置文件），只有刷新页面能拿到新的浏览器启动图。

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

# patch 块：绝对路径形式（默认）或包名形式（-Link）
$rowName = if ($PnpmLink) { $packageName } else { ($entry -replace '\\', '/') }
$patchBlock = @"
# --- 每条助手回复右下角的「模型 · 思考深度 · 用量」徽章（本地插件 $packageName）---
- insert:
    - id: turn-meta-badge
      name: $rowName
"@
# 卸载时按这个标记定位本插件写入的整块内容。
$blockMarker = "# --- 每条助手回复右下角的「模型 · 思考深度 · 用量」徽章"

function Backup-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $backup = "$Path.bak-$packageName"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Host "已备份：$backup"
}

function Remove-PatchBlock([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($text -notmatch [regex]::Escape($blockMarker)) { return }
    Backup-File $Path
    $pattern = "(?ms)^" + [regex]::Escape($blockMarker) + ".*?(?=^- |\z)"
    $cleaned = [regex]::Replace($text, $pattern, '')
    $cleaned = ($cleaned -replace "(`r?`n){3,}", "`n`n").TrimEnd() + "`n"
    Set-Content -LiteralPath $Path -Value $cleaned -Encoding UTF8 -NoNewline
    Write-Host "已从 cordis.patch.yml 移除 patch 块"
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

    Remove-PatchBlock $patchPath

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

# 2) 写 patch 行
if (-not (Test-Path -LiteralPath $patchPath)) {
    Set-Content -LiteralPath $patchPath -Value ($patchBlock + "`n") -Encoding UTF8
    Write-Host '已创建 cordis.patch.yml 并写入 patch 块'
}
else {
    $patch = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8
    if ($patch -match [regex]::Escape($blockMarker)) {
        # 已存在：整块替换，避免路径/形式变更后留下旧行。
        Backup-File $patchPath
        $pattern = "(?ms)^" + [regex]::Escape($blockMarker) + ".*?(?=^- |\z)"
        $updated = [regex]::Replace($patch, $pattern, $patchBlock + "`n")
        $updated = ($updated -replace "(`r?`n){3,}", "`n`n").TrimEnd() + "`n"
        Set-Content -LiteralPath $patchPath -Value $updated -Encoding UTF8 -NoNewline
        Write-Host '已更新 cordis.patch.yml 中的 patch 块'
    }
    else {
        Backup-File $patchPath
        $updated = $patch.TrimEnd() + "`n`n" + $patchBlock + "`n"
        Set-Content -LiteralPath $patchPath -Value $updated -Encoding UTF8 -NoNewline
        Write-Host '已在 cordis.patch.yml 追加 patch 块'
    }
}

Write-Host ''
Write-Host "安装完成（row name: $rowName）。"
Write-Host 'profile patch 层受 HMR 监视，新行通常几秒内挂载；随后刷新页面（Ctrl+R）拿到新的浏览器启动图。'
Write-Host '验证：每条助手回复右下角应出现「模型 · 思考深度 X · 用量 N tok」。'
