# Debug / release APK for 琅嬛. Windows notes:
# - JAVA_HOME must be JDK 21 (not 25).
# - Put CARGO_TARGET_DIR on an ASCII path: NDK lld cannot open 中文仓库路径.
# - Copy libapp_lib.so instead of symlink (Windows without Developer Mode).
# - Release needs src-tauri/gen/android/keystore.properties (gitignored).
param(
  [switch]$Release,
  [switch]$GradleOnly,
  [ValidateSet("all", "arm64", "x86_64")][string]$Abi = "all",
  [string]$VersionName = "",
  [int]$VersionCode = -1
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "E:\java\jdk-21.0.2" }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "E:\Android\Sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$NdkHome = if ($env:NDK_HOME) { $env:NDK_HOME } else { Join-Path $env:ANDROID_HOME "ndk\29.0.13846066" }
$NdkBin = Join-Path $NdkHome "toolchains\llvm\prebuilt\windows-x86_64\bin"
$TargetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "E:\tmp\langhuan-android-target" }
$env:CARGO_TARGET_DIR = $TargetDir
$env:NDK_HOME = $NdkHome
$env:ANDROID_NDK_HOME = $NdkHome
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $NdkBin "aarch64-linux-android24-clang.cmd"
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = Join-Path $NdkBin "x86_64-linux-android24-clang.cmd"
$env:CC_aarch64_linux_android = $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER
$env:CC_x86_64_linux_android = $env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER
$env:AR_aarch64_linux_android = Join-Path $NdkBin "llvm-ar.exe"
$env:AR_x86_64_linux_android = Join-Path $NdkBin "llvm-ar.exe"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

$ProfileName = if ($Release) { "release" } else { "debug" }
$StripExe = Join-Path $NdkBin "llvm-strip.exe"

function Write-AndroidVersion {
  param([string]$Name, [int]$Code)
  $props = Join-Path $Root "src-tauri\gen\android\app\tauri.properties"
  $curName = "0.1.0"
  $curCode = 1
  if (Test-Path $props) {
    Get-Content $props | ForEach-Object {
      if ($_ -match "^tauri\.android\.versionName=(.+)$") { $curName = $Matches[1].Trim() }
      if ($_ -match "^tauri\.android\.versionCode=(\d+)$") { $curCode = [int]$Matches[1] }
    }
  }
  if ($Name) { $curName = $Name }
  if ($Code -ge 0) { $curCode = $Code }
  "tauri.android.versionCode=$curCode`ntauri.android.versionName=$curName`n" | Set-Content -Encoding ascii $props
  Write-Host "versionName=$curName versionCode=$curCode"
}

Set-Location $Root
Write-AndroidVersion -Name $VersionName -Code $VersionCode

if ($Release) {
  $ks = Join-Path $Root "src-tauri\gen\android\keystore.properties"
  if (-not (Test-Path $ks)) {
    throw "缺少 $ks（已 gitignore）。按 STATUS-android.md 生成本机 keystore 后再打 release。"
  }
}

if (-not $GradleOnly) {
  npm run desktop:ui
}

function Build-Abi([string]$Triple, [string]$JniAbi) {
  if ($GradleOnly) {
    $so = Join-Path $TargetDir "$Triple\$ProfileName\libapp_lib.so"
    if (-not (Test-Path $so)) { throw "GradleOnly 但找不到 $so" }
  } else {
    Push-Location (Join-Path $Root "src-tauri")
    if ($Release) {
      cargo build -p langhuan --target $Triple --features "tauri/custom-protocol" --lib --release
    } else {
      cargo build -p langhuan --target $Triple --features "tauri/custom-protocol" --lib
    }
    Pop-Location
    $so = Join-Path $TargetDir "$Triple\$ProfileName\libapp_lib.so"
  }
  if ($Release -and (Test-Path $StripExe)) {
    & $StripExe --strip-all $so
    if ($LASTEXITCODE -ne 0) { throw "llvm-strip failed for $so" }
  }
  $destDir = Join-Path $Root "src-tauri\gen\android\app\src\main\jniLibs\$JniAbi"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -Force $so (Join-Path $destDir "libapp_lib.so")
  $len = (Get-Item $so).Length
  Write-Host ("  {0} libapp_lib.so {1:N1} MB" -f $JniAbi, ($len / 1MB))
}

if ($Abi -eq "all" -or $Abi -eq "arm64") {
  Build-Abi "aarch64-linux-android" "arm64-v8a"
}
if ($Abi -eq "all" -or $Abi -eq "x86_64") {
  Build-Abi "x86_64-linux-android" "x86_64"
}

if (-not $GradleOnly) {
  $assets = Join-Path $Root "src-tauri\gen\android\app\src\main\assets"
  New-Item -ItemType Directory -Force -Path $assets | Out-Null
  Copy-Item -Force -Recurse (Join-Path $Root "out\*") $assets
  Copy-Item -Force (Join-Path $Root "src-tauri\tauri.conf.json") (Join-Path $assets "tauri.conf.json")
}

Set-Location (Join-Path $Root "src-tauri\gen\android")
$skip = @(
  "-x", "rustBuildArm64Debug", "-x", "rustBuildArmDebug", "-x", "rustBuildX86Debug",
  "-x", "rustBuildX86_64Debug", "-x", "rustBuildUniversalDebug",
  "-x", "rustBuildArm64Release", "-x", "rustBuildArmRelease", "-x", "rustBuildX86Release",
  "-x", "rustBuildX86_64Release", "-x", "rustBuildUniversalRelease"
)
$tasks = @()
if ($Release) {
  if ($Abi -eq "all" -or $Abi -eq "arm64") { $tasks += ":app:assembleArm64Release" }
  if ($Abi -eq "all" -or $Abi -eq "x86_64") { $tasks += ":app:assembleX86_64Release" }
} else {
  if ($Abi -eq "all" -or $Abi -eq "arm64") { $tasks += ":app:assembleArm64Debug" }
  if ($Abi -eq "all" -or $Abi -eq "x86_64") { $tasks += ":app:assembleX86_64Debug" }
}

& .\gradlew.bat @tasks @skip
if ($LASTEXITCODE -ne 0) { throw "gradle assemble failed" }

function Resign-ReleaseApk([string]$Apk) {
  if (-not $Release) { return }
  if (-not (Test-Path $Apk)) { throw "找不到 $Apk" }
  $propsPath = Join-Path $Root "src-tauri\gen\android\keystore.properties"
  $kv = @{}
  Get-Content $propsPath | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
    $k, $v = $_ -split "=", 2
    $kv[$k.Trim()] = $v.Trim()
  }
  $signer = Join-Path $env:ANDROID_HOME "build-tools\36.0.0\apksigner.bat"
  if (-not (Test-Path $signer)) {
    $signer = Get-ChildItem (Join-Path $env:ANDROID_HOME "build-tools") -Recurse -Filter apksigner.bat |
      Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  $out = "$Apk.signed"
  $env:LANGHUAN_KS_PASS = $kv["storePassword"]
  $env:LANGHUAN_KEY_PASS = $kv["keyPassword"]
  try {
    & $signer sign `
      --ks $kv["storeFile"] `
      --ks-key-alias $kv["keyAlias"] `
      --ks-pass env:LANGHUAN_KS_PASS `
      --key-pass env:LANGHUAN_KEY_PASS `
      --v1-signing-enabled true `
      --v1-signer-name CERT `
      --v2-signing-enabled true `
      --v3-signing-enabled false `
      --v4-signing-enabled false `
      --out $out `
      $Apk
    if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }
    Move-Item -Force $out $Apk
    & $signer verify --min-sdk-version 23 $Apk
    if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }
    Write-Host "  resigned v1+v2 $Apk"
  } finally {
    Remove-Item Env:LANGHUAN_KS_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:LANGHUAN_KEY_PASS -ErrorAction SilentlyContinue
  }
}

$kind = if ($Release) { "release" } else { "debug" }
Write-Host "APKs:"
if ($Abi -eq "all" -or $Abi -eq "arm64") {
  $p = Join-Path $Root "src-tauri\gen\android\app\build\outputs\apk\arm64\$kind\app-arm64-$kind.apk"
  Write-Host "  $p"
  Resign-ReleaseApk $p
}
if ($Abi -eq "all" -or $Abi -eq "x86_64") {
  $p = Join-Path $Root "src-tauri\gen\android\app\build\outputs\apk\x86_64\$kind\app-x86_64-$kind.apk"
  Write-Host "  $p"
  Resign-ReleaseApk $p
}
