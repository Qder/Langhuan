# Print gh commands to publish Android APK + android-latest.json.
# Does NOT upload secrets. Requires: gh auth, built arm64 release APK.
param(
  [Parameter(Mandatory = $true)][int]$VersionCode,
  [Parameter(Mandatory = $true)][string]$VersionName,
  [string]$Notes = "",
  [string]$Tag = "",
  [string]$Apk = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Tag) { $Tag = "v$VersionName" }
if (-not $Notes) { $Notes = "琅嬛 Android $VersionName ($VersionCode)" }
if (-not $Apk) {
  $Apk = Join-Path $Root "src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk"
}
if (-not (Test-Path $Apk)) { throw "找不到 APK：$Apk 。先 npm run android:apk:release" }

$UrlBase = "https://github.com/Qder/Langhuan/releases/download/$Tag"
$OutJson = Join-Path (Split-Path $Apk -Parent) "android-latest.json"

Push-Location $Root
node scripts/write-android-latest-json.mjs `
  --version-code $VersionCode `
  --version-name $VersionName `
  --apk $Apk `
  --notes $Notes `
  --url-base $UrlBase `
  --out $OutJson
Pop-Location

Write-Host ""
Write-Host "下一步（需 gh auth；勿提交 keystore）："
Write-Host "  gh release create $Tag `"$Apk`" `"$OutJson`" --title `"琅嬛 $VersionName (Android)`" --notes `"$Notes`""
Write-Host "若 Release 已存在："
Write-Host "  gh release upload $Tag `"$Apk`" `"$OutJson`" --clobber"
Write-Host "确认 latest 能下载：https://github.com/Qder/Langhuan/releases/latest/download/android-latest.json"
