import { describe, expect, it } from "vitest";
import {
  directoryPickerSupported,
  folderDirectoryImportSupported,
  isAndroidUserAgent,
} from "./platform";

describe("directoryPickerSupported", () => {
  it("accepts real Chrome / Edge desktop", () => {
    expect(
      directoryPickerSupported({
        hasShowDirectoryPicker: true,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
      })
    ).toBe(true);
  });

  it("rejects Android WebView even though the function exists", () => {
    // 实测：Android WebView 里 showDirectoryPicker 是 function，
    // 一调用就让 Tauri 的 showFilePicker NPE、进程被杀。
    expect(
      directoryPickerSupported({
        hasShowDirectoryPicker: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 17; sdk_gphone64_x86_64 Build/CE2A.260420.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36",
      })
    ).toBe(false);
  });

  it("rejects when the API is missing", () => {
    expect(
      directoryPickerSupported({ hasShowDirectoryPicker: false, userAgent: "Mozilla/5.0" })
    ).toBe(false);
  });

  it("treats a missing UA as non-Android (do not over-block)", () => {
    expect(directoryPickerSupported({ hasShowDirectoryPicker: true, userAgent: null })).toBe(true);
  });
});

describe("isAndroidUserAgent", () => {
  it("matches Android case-insensitively", () => {
    expect(isAndroidUserAgent("Mozilla/5.0 (Linux; Android 15)")).toBe(true);
    expect(isAndroidUserAgent("mozilla/5.0 (linux; android 15)")).toBe(true);
  });

  it("does not match desktop platforms", () => {
    expect(isAndroidUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isAndroidUserAgent("")).toBe(false);
    expect(isAndroidUserAgent(undefined)).toBe(false);
  });
});

describe("folderDirectoryImportSupported", () => {
  it("is false on Android (use zip instead)", () => {
    expect(
      folderDirectoryImportSupported({
        userAgent:
          "Mozilla/5.0 (Linux; Android 17; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36",
      })
    ).toBe(false);
  });

  it("is true on desktop UA", () => {
    expect(
      folderDirectoryImportSupported({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0",
      })
    ).toBe(true);
  });
});

