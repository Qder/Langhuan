/**
 * 运行环境判断（纯字符串 / 全局对象检查，无依赖，node 里也能 import）。
 *
 * 为什么单独一个文件：Android WebView 会**声称**支持 File System Access
 * （`typeof window.showDirectoryPicker === "function"`），但真调用时走的是
 * `RustWebChromeClient.showFilePicker`，chooser params 里 `intent.type` 为 null，
 * 生成代码里的 `intent.type!!` 直接 NPE，整个 app 被系统杀掉。
 * 所以「支持目录选择」不能只看函数在不在，必须先排除 Android。
 */

const ANDROID_UA = /android/i;

export function isAndroidUserAgent(ua: string | undefined | null): boolean {
  return !!ua && ANDROID_UA.test(ua);
}

export function isAndroidWebView(): boolean {
  return typeof navigator !== "undefined" && isAndroidUserAgent(navigator.userAgent);
}

/** Tauri 2 webview（含 Android 上的 Tauri）。 */
export function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

/** Android 上的琅嬛（Tauri Android APK）。 */
export function isTauriAndroidRuntime(): boolean {
  return isTauriShell() && isAndroidWebView();
}

/** 桌面 Tauri（Windows / macOS / Linux），不含 Android。 */
export function isTauriDesktopRuntime(): boolean {
  return isTauriShell() && !isAndroidWebView();
}

/**
 * 这个环境能不能真的用目录选择器（File System Access）。
 *
 * 纯函数，方便测试：只看「函数在不在」和「是不是 Android」。
 * Android WebView 里 `showDirectoryPicker` 存在，但调用会走 Tauri 的
 * `showFilePicker`，chooser params 没 accept 时 `intent.type` 为 null，
 * 生成代码的 `intent.type!!` NPE，进程被杀。所以 Android 一律当不支持。
 */
export function directoryPickerSupported(input: {
  hasShowDirectoryPicker: boolean;
  userAgent?: string | null;
}): boolean {
  if (!input.hasShowDirectoryPicker) return false;
  return !isAndroidUserAgent(input.userAgent);
}
