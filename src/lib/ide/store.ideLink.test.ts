/**
 * Notes → 读码 deep link behaviour (B3).
 *
 * Parsing is covered in ideLink.test.ts; here we only check the store-side
 * consequences: no project open (remember + hint), project open (jump),
 * missing file (clear failure message), and consuming the pending link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIdeStore } from "./store";
import type { IdeFolderSession } from "./ideFs";

const existing = new Set(["src/A.java"]);

vi.mock("./ideFs", async () => {
  const actual = await vi.importActual<typeof import("./ideFs")>("./ideFs");
  return {
    ...actual,
    listIdeDir: vi.fn(async () => []),
    readIdeFile: vi.fn(async (_session: IdeFolderSession, relPath: string) => {
      if (!existing.has(relPath.replace(/\\/g, "/"))) {
        throw new Error("NotFoundError");
      }
      return "line1\nline2\nline3\nline4\n";
    }),
  };
});

const fakeSession: IdeFolderSession = {
  id: "link-session",
  name: "demo",
  pathLabel: "demo",
  handle: {} as FileSystemDirectoryHandle,
  absRoot: null,
};

function reset(session: IdeFolderSession | null) {
  useIdeStore.setState({
    session,
    tabs: [],
    activePath: null,
    pendingReveal: null,
    pendingIdeLink: null,
    recentFiles: [],
    expanded: { "": true },
    children: { "": [] },
    status: null,
  });
}

describe("followIdeLink", () => {
  beforeEach(() => reset(null));

  it("没有工程时不假装打开：记住 pending 并给出提示", async () => {
    const ok = await useIdeStore
      .getState()
      .followIdeLink({ path: "src/A.java", line: 3 });

    expect(ok).toBe(false);
    const st = useIdeStore.getState();
    expect(st.pendingIdeLink).toEqual({ path: "src/A.java", line: 3 });
    expect(st.status).toContain("src/A.java");
    expect(st.status).toContain("第 3 行");
    expect(st.activePath).toBeNull();
  });

  it("已打开工程时直接跳行，并清掉 pending", async () => {
    reset(fakeSession);
    useIdeStore.setState({ pendingIdeLink: { path: "src/A.java", line: 1 } });
    const ok = await useIdeStore
      .getState()
      .followIdeLink({ path: "src/A.java", line: 3 });

    expect(ok).toBe(true);
    const st = useIdeStore.getState();
    expect(st.activePath).toBe("src/A.java");
    expect(st.pendingReveal).toEqual({ path: "src/A.java", line: 3 });
    expect(st.pendingIdeLink).toBeNull();
  });

  it("有工程但文件不存在：留下 pending 并说明原因，方便切到对的工程", async () => {
    reset(fakeSession);
    const ok = await useIdeStore
      .getState()
      .followIdeLink({ path: "src/Missing.java", line: 1 });

    expect(ok).toBe(false);
    const st = useIdeStore.getState();
    expect(st.status).toContain("src/Missing.java");
    expect(st.status).toContain("没有");
    // Kept so opening the project that actually owns the file still lands.
    expect(st.pendingIdeLink).toEqual({ path: "src/Missing.java", line: 1 });
    expect(st.activePath).toBeNull();
  });

  it("空路径直接拒绝", async () => {
    reset(fakeSession);
    const ok = await useIdeStore.getState().followIdeLink({ path: "   " });
    expect(ok).toBe(false);
    expect(useIdeStore.getState().status).toContain("没有可用的文件路径");
  });

  it("consumePendingIdeLink 消费后清空", async () => {
    reset(fakeSession);
    useIdeStore.setState({ pendingIdeLink: { path: "src/A.java", line: 2 } });
    await useIdeStore.getState().consumePendingIdeLink();
    const st = useIdeStore.getState();
    expect(st.pendingIdeLink).toBeNull();
    expect(st.activePath).toBe("src/A.java");
  });

  it("consumePendingIdeLink 打不开时保留 pending 并说明原因", async () => {
    reset(fakeSession);
    useIdeStore.setState({ pendingIdeLink: { path: "src/Gone.java", line: 7 } });
    await useIdeStore.getState().consumePendingIdeLink();
    const st = useIdeStore.getState();
    expect(st.pendingIdeLink).toEqual({ path: "src/Gone.java", line: 7 });
    expect(st.status).toContain("src/Gone.java");
    expect(st.activePath).toBeNull();
  });

  it("dismiss 之后不再纠缠；再点链会重新挂起", async () => {
    reset(null);
    await useIdeStore.getState().followIdeLink({ path: "src/A.java", line: 4 });
    expect(useIdeStore.getState().pendingIdeLink).not.toBeNull();

    useIdeStore.getState().clearPendingIdeLink();
    expect(useIdeStore.getState().pendingIdeLink).toBeNull();

    await useIdeStore.getState().followIdeLink({ path: "src/A.java", line: 5 });
    expect(useIdeStore.getState().pendingIdeLink).toEqual({
      path: "src/A.java",
      line: 5,
    });
  });
});

describe("recentFiles", () => {
  beforeEach(() => reset(fakeSession));

  it("打开文件后记录到最近文件，带工程名", async () => {
    await useIdeStore.getState().openFile("src/A.java");
    const files = useIdeStore.getState().recentFiles;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      sessionId: "link-session",
      projectName: "demo",
      path: "src/A.java",
    });
  });

  it("重复打开同一文件只保留一条", async () => {
    await useIdeStore.getState().openFile("src/A.java");
    await useIdeStore.getState().openFile("src/A.java", { line: 2 });
    const files = useIdeStore.getState().recentFiles;
    expect(files.filter((f) => f.path === "src/A.java")).toHaveLength(1);
  });
});
