import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { libraryFolderScanToImport, pickLibraryFolderImport } from "./importLibraryFolder";
import { isAndroidSafAvailable, pickAndScanSafLibrary, type SafLibraryScan } from "./android/saf";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const scan = (content: Partial<SafLibraryScan> = {}): SafLibraryScan => ({ docs: [], assets: [], skipped: [], truncated: false, ...content });
const doc = (path: string, content = "正文") => ({ path, content, size: 0, mtime: 0 });
const asset = (path: string, base64 = "AQID") => ({ path, base64, mime: "application/octet-stream", size: 0, mtime: 0 });
const source = (path: string) => readFileSync(path, "utf8");

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("SAF notes folder capability and cancellation", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla Android" });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });
  it("only offers native SAF in an Android shell", () => {
    expect(isAndroidSafAvailable()).toBe(true);
    vi.stubGlobal("window", {});
    expect(isAndroidSafAvailable()).toBe(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    expect(isAndroidSafAvailable()).toBe(false);
  });
  it("does not invoke anything in a tablet browser without SAF", async () => {
    vi.stubGlobal("window", {});
    await expect(pickLibraryFolderImport()).rejects.toThrow(/Android 应用.*导入笔记 zip/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses the library command, not bind-tree or IDE scan", async () => {
    vi.mocked(invoke).mockResolvedValue(scan({ docs: [doc("笔记/a.md")] }));
    const res = await pickLibraryFolderImport();
    expect(res?.docs[0].path).toBe("笔记/a.md");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("android_saf_pick_and_scan_library");
  });
  it("cancel returns null instead of an import success", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("已取消选择文件夹"));
    await expect(pickLibraryFolderImport()).resolves.toBeNull();
  });
  it("keeps permission and provider errors as failures", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("没有读取权限"));
    await expect(pickLibraryFolderImport()).rejects.toThrow("没有读取权限");
  });
  it("rejects a project-sandbox shaped or empty response", async () => {
    vi.mocked(invoke).mockResolvedValue({ files: [], skipped: [] });
    await expect(pickAndScanSafLibrary()).rejects.toThrow("扫描结果无效");
    vi.mocked(invoke).mockResolvedValue(scan({ skipped: [{ path: "a.js", reason: "不支持的笔记或图片类型" }] }));
    await expect(pickLibraryFolderImport()).rejects.toThrow(/没有可导入.*[\s\S]*a.js/);
  });
});

describe("SAF notes → ImportFolderDialog docs/assets", () => {
  it("keeps relative paths, maps txt to md, and decodes real binary images", async () => {
    const res = libraryFolderScanToImport(scan({
      docs: [doc("笔记/a.md"), doc("笔记/sub/b.txt"), doc("笔记/c.html", "<p>文</p>"), doc("笔记/d.svg", "<svg/>")],
      assets: [asset("笔记/sub/图.PNG")],
    }));
    expect(res.docs.map((d) => d.path)).toEqual(["笔记/a.md", "笔记/c.html", "笔记/d.svg", "笔记/sub/b.md"]);
    expect(res.assets[0].path).toBe("笔记/sub/图.PNG");
    expect(res.assets[0].mime).toBe("image/png");
    expect([...new Uint8Array(await res.assets[0].blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(res.details.join("\n")).toContain("不绑定或写回");
  });
  it("matches notes-zip ignores and excludes project source/pdf/ico", () => {
    const res = libraryFolderScanToImport(scan({
      docs: ["__MACOSX/x.md", "node_modules/a.md", ".git/a.md", ".DS_Store", "x/.cache/a.md", "../escape.md", "a.js", "a.css", "build/keep.md", "dist/keep.md"].map((p) => doc(p)),
      assets: [asset("x.pdf"), asset("x.ico"), asset("assets/a.webp")],
    }));
    expect(res.docs.map((d) => d.path)).toEqual(["build/keep.md", "dist/keep.md"]);
    expect(res.assets.map((a) => a.path)).toEqual(["assets/a.webp"]);
    expect(res.details.join("\n")).toContain("忽略目录或文件规则");
    expect(res.details.join("\n")).toContain("不支持的笔记或图片类型");
  });
  it("reports native skips, truncation, invalid images and duplicate paths", () => {
    const res = libraryFolderScanToImport(scan({
      docs: [doc("a.md"), doc("a.txt")], assets: [asset("broken.png", "!bad!")],
      skipped: [{ path: "secret.md", reason: "读取失败" }], truncated: true,
    }));
    expect(res.docs).toHaveLength(1);
    expect(res.assets).toHaveLength(0);
    expect(res.details.join("\n")).toMatch(/截断[\s\S]*读取失败[\s\S]*重复导入路径[\s\S]*图片数据无效/);
  });
  it("limits kept files to 2000 including images", () => {
    const res = libraryFolderScanToImport(scan({ docs: Array.from({ length: 2001 }, (_, i) => doc(`${i}.md`, "")) }));
    expect(res.docs).toHaveLength(2000);
    expect(res.details.join("\n")).toContain("超过 2000 文件上限");
  });
  it("enforces 8 MiB with actual UTF-8 byte sizes, not bridge metadata", () => {
    const res = libraryFolderScanToImport(scan({ docs: [doc("large.md", "中".repeat(3 * 1024 * 1024)), doc("ok.md")] }));
    expect(res.docs.map((d) => d.path)).toEqual(["ok.md"]);
    expect(res.details.join("\n")).toContain("单文件超过 8 MiB");
  });
  it("rejects oversized image payloads before decoding", () => {
    const res = libraryFolderScanToImport(scan({ assets: [asset("large.png", "A".repeat(12 * 1024 * 1024))] }));
    expect(res.assets).toHaveLength(0);
    expect(res.details.join("\n")).toContain("单文件超过 8 MiB");
  });
  it("enforces 64 MiB total and accepts the exact per-file limit", () => {
    const content = "x".repeat(8 * 1024 * 1024);
    const res = libraryFolderScanToImport(scan({ docs: Array.from({ length: 9 }, (_, i) => doc(`${i}.md`, content)) }));
    expect(res.docs).toHaveLength(8);
    expect(res.details.join("\n")).toContain("合计超过 64 MiB");
  });
});

describe("native and UI import separation contracts (not a device test)", () => {
  it("selects read-only, preserves existing grants, releases only acquired grants, never binds or writes", () => {
    const kt = source("src-tauri/gen/android/app/src/main/java/com/qder/langhuan/SafPlugin.kt");
    const block = kt.slice(kt.indexOf("  fun pickAndScanLibrary"), kt.indexOf("  @Command\n  fun writeText"));
    expect(block).toContain("ACTION_OPEN_DOCUMENT_TREE");
    expect(block).toContain("persistedUriPermissions.any");
    expect(block).toContain("it.uri == uri && it.isReadPermission");
    expect(block).toContain("if (!alreadyReadable)");
    expect(block).toMatch(/finally[\s\S]*if \(taken\)[\s\S]*releasePersistableUriPermission/);
    expect(block).not.toMatch(/KEY_URI|prefs\.edit|FLAG_GRANT_WRITE_URI_PERMISSION|scanProjectTree|requireRoot\(|writeBytes\(/);
    expect(block).toContain("scanLibraryTree(root)");
    expect(block).toContain("out.size().toLong() + n > MAX_FILE_BYTES");
    expect(block).toContain("kept >= MAX_FILES");
    expect(block).toContain("totalBytes + bytes.size > MAX_TOTAL_BYTES");
  });
  it("registers a distinct native command through Rust and ACL", () => {
    expect(source("src-tauri/src/android_saf.rs")).toContain('run_mobile_plugin_async::<SafLibraryScan>("pickAndScanLibrary", ())');
    expect(source("src-tauri/src/lib.rs")).toContain("android_saf::android_saf_pick_and_scan_library,");
    expect(source("src-tauri/permissions/android_saf.toml")).toContain('"android_saf_pick_and_scan_library"');
  });
  it("keeps both entry points and confirmation, Web folder picker on desktop only", () => {
    for (const name of ["HomeView", "Sidebar"]) {
      const ui = source(`src/components/${name}.tsx`);
      expect(ui).toContain("pickLibraryFolderImport()");
      expect(ui).toContain('if (!isAndroidWebView()) {\n      folderRef.current?.click();');
      expect(ui).toContain("导入文件夹");
      expect(ui).toContain("导入笔记 zip");
      expect(ui).toContain("<ImportFolderDialog");
      expect(ui).toContain("details={pendingImport?.details}");
      const handler = ui.slice(ui.indexOf("  const onPickFolderImport"), ui.indexOf("  const onPickFolderImport") + 800);
      expect(handler).not.toContain("showDirectoryPicker");
    }
    const ui = source("src/components/Sidebar.tsx");
    expect(ui).toMatch(/const onPickProjectFolder[\s\S]*if \(isAndroidWebView\(\)\)[\s\S]*请用桌面浏览器/);
    const conversion = source("src/lib/importLibraryFolder.ts");
    expect(conversion).not.toMatch(/importProject|createSandbox|pickSafTree|writeSaf|useStore|showDirectoryPicker/);
  });
});
