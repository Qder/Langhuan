import { describe, expect, it } from "vitest";
import { ideFsCapabilityFrom } from "./ideFs";

describe("ideFsCapabilityFrom", () => {
  it("keeps canPickFolder false on Android APK and offers SAF import instead", () => {
    const cap = ideFsCapabilityFrom({
      hasWindow: true,
      fsAccess: false,
      tauriAndroid: true,
      androidWebView: true,
      tauriRuntime: true,
    });
    expect(cap.canPickFolder).toBe(false);
    expect(cap.canImportSafFolder).toBe(true);
    expect(cap.canImportZip).toBe(true);
    expect(cap.canOpenProject).toBe(true);
    expect(cap.folderHint).toMatch(/选择文件夹/);
    expect(cap.folderHint).toMatch(/不会自动写回原文件夹/);
  });

  it("does not pretend the Android browser can pick a system folder", () => {
    const cap = ideFsCapabilityFrom({
      hasWindow: true,
      fsAccess: false,
      tauriAndroid: false,
      androidWebView: true,
      tauriRuntime: false,
    });
    expect(cap.canPickFolder).toBe(false);
    expect(cap.canImportSafFolder).toBe(false);
    expect(cap.canImportZip).toBe(true);
    expect(cap.folderHint).toMatch(/浏览器/);
  });

  it("leaves desktop File System Access as live folder open", () => {
    const cap = ideFsCapabilityFrom({
      hasWindow: true,
      fsAccess: true,
      tauriAndroid: false,
      androidWebView: false,
      tauriRuntime: false,
    });
    expect(cap.canPickFolder).toBe(true);
    expect(cap.canImportSafFolder).toBe(false);
    expect(cap.folderHint).toBe("");
  });
});
