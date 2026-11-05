# Debug APK for 琅嬛. Windows notes:
# - JAVA_HOME must be JDK 21 (not 25).
# - Put CARGO_TARGET_DIR on an ASCII path: NDK lld cannot open 中文仓库路径.
# - Copy libapp_lib.so instead of symlink (Windows without Developer Mode).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
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

Set-Location $Root
npm run desktop:ui

function Build-Abi([string]$Triple, [string]$JniAbi) {
  Push-Location (Join-Path $Root "src-tauri")
  cargo build -p langhuan --target $Triple --features "tauri/custom-protocol" --lib
  Pop-Location
  $so = Join-Path $TargetDir "$Triple\debug\libapp_lib.so"
  $destDir = Join-Path $Root "src-tauri\gen\android\app\src\main\jniLibs\$JniAbi"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -Force $so (Join-Path $destDir "libapp_lib.so")
}

Build-Abi "aarch64-linux-android" "arm64-v8a"
Build-Abi "x86_64-linux-android" "x86_64"

$assets = Join-Path $Root "src-tauri\gen\android\app\src\main\assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Force -Recurse (Join-Path $Root "out\*") $assets
Copy-Item -Force (Join-Path $Root "src-tauri\tauri.conf.json") (Join-Path $assets "tauri.conf.json")

$props = Join-Path $Root "src-tauri\gen\android\app\tauri.properties"
if (-not (Test-Path $props)) {
  "tauri.android.versionCode=1`ntauri.android.versionName=0.1.0`n" | Set-Content -Encoding ascii $props
}

Set-Location (Join-Path $Root "src-tauri\gen\android")
.\gradlew.bat :app:assembleArm64Debug :app:assembleX86_64Debug `
  -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug -x rustBuildUniversalDebug

Write-Host "APKs:"
Write-Host "  src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
Write-Host "  src-tauri\gen\android\app\build\outputs\apk\x86_64\debug\app-x86_64-debug.apk"
