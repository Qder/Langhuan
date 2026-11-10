// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCurrentBuild, androidBuildId, cacheReleaseNotes, releaseNotesFor, shouldShowReleaseNotes, markReleaseNotesSeen, BUNDLED_NOTES } from "./releaseNotes";
import { isTauriAndroid, currentAppVersion } from "./desktop/updater";
import { readAndroidAppVersion } from "./android/updater";
vi.mock("./desktop/updater", () => ({ isTauriAndroid: vi.fn(), currentAppVersion: vi.fn() }));
vi.mock("./android/updater", () => ({ readAndroidAppVersion: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.mocked(isTauriAndroid).mockReturnValue(false); vi.mocked(currentAppVersion).mockResolvedValue("0.1.0"); });
describe("真实版本与一次性更新说明", () => {
  it("Android 优先 PackageManager versionName/code，不显示 tauri/package 常量", async () => {
    vi.mocked(isTauriAndroid).mockReturnValue(true);
    vi.mocked(readAndroidAppVersion).mockResolvedValue({ versionName: "0.2.0", versionCode: 16 });
    const build = await readCurrentBuild();
    expect(build).toEqual({ id: "android:0.2.0:16", label: "0.2.0 · versionCode 16" });
  });
  it("Android 读版本失败不假装回落成另一个版本", async () => {
    vi.mocked(isTauriAndroid).mockReturnValue(true);
    vi.mocked(readAndroidAppVersion).mockRejectedValue(new Error("native unavailable"));
    await expect(readCurrentBuild()).rejects.toThrow("native unavailable");
  });
  it("同一 native 版本不重复弹窗，code 变化才视为升级", () => {
    const a = { id: androidBuildId("0.2.0", 16), label: "0.2.0" };
    expect(shouldShowReleaseNotes(a)).toBe(true); markReleaseNotesSeen(a);
    expect(shouldShowReleaseNotes(a)).toBe(false);
    expect(shouldShowReleaseNotes({ ...a, id: androidBuildId("0.2.0", 17) })).toBe(true);
  });
  it("只使用精确匹配已安装版本的真实更新 notes，否则明确使用本构建说明", () => {
    const installed = { id: "android:0.2.0:16", label: "0.2.0" };
    cacheReleaseNotes("android:0.3.0:20", "未来版本说明");
    expect(releaseNotesFor(installed)).toBe(BUNDLED_NOTES);
    cacheReleaseNotes(installed.id, "真实更新清单 notes");
    expect(releaseNotesFor(installed)).toBe("真实更新清单 notes");
  });
  it("桌面用真实运行时版本，浏览器不冒充 APK 版本", async () => {
    expect(await readCurrentBuild()).toEqual({ id: "desktop:0.1.0", label: "0.1.0" });
    vi.mocked(currentAppVersion).mockResolvedValue("浏览器");
    expect((await readCurrentBuild()).label).toBe("浏览器 · 本地前端构建");
  });
});
