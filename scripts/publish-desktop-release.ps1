# 半自动：NSIS + .sig 打好后生成 latest.json，并打印 gh 上传命令。
# 私钥只从环境变量读；本脚本不写、不打印密钥。
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "琅嬛 $Version",
  [string]$Repo = "Qder/Langhuan"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$trackedKeys = git ls-files "*.key" ".env.updater"
if ($trackedKeys) {
  throw "拒绝发布：git 里出现了密钥文件：`n$trackedKeys"
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  Write-Warning "TAURI_SIGNING_PRIVATE_KEY 未设。若 .sig 已经打好，仍可生成 latest.json。"
}

$urlBase = "https://github.com/$Repo/releases/download/v$Version"
node scripts/write-latest-json.mjs --version $Version --notes $Notes --url-base $urlBase

$setup = "src-tauri/target/release/bundle/nsis/琅嬛_${Version}_x64-setup.exe"
Write-Host ""
Write-Host "下一步（需 gh auth；资产名必须含 latest.json）："
Write-Host "  git tag v$Version"
Write-Host "  git push origin v$Version"
Write-Host "  gh release create v$Version --repo $Repo --title `"琅嬛 $Version`" --notes `"$Notes`" `"$setup`" `"$setup.sig`" src-tauri/target/release/bundle/nsis/latest.json"
Write-Host "应用检查的地址："
Write-Host "  https://github.com/$Repo/releases/latest/download/latest.json"
