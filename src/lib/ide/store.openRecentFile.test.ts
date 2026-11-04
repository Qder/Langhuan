import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIdeStore } from "./store";
import type { IdeFolderSession } from "./ideFs";

/**
 * Project switching for the welcome screen's 最近文件 rows.
 *
 * The bug this covers: with no project open the rows were treated as "current
 * project" and `openFile` returned false without touching status — a dead
 * click. They now route through `openRecentFile`, which switches project and
 * always explains a failure.
 */

const openRecentMock = vi.fn<(id: string) => Promise<boolean>>();

vi.mock("./ideFs", async () => {
  const actual = await vi.importActual<typeof import("./ideFs")>("./ideFs");
  return {
    ...actual,
    listIdeDir: vi.fn(async () => []),
    readIdeFile: vi.fn(async (_s: IdeFolderSession, path: string) => {
      if (path === "missing.ts") throw new Error("NotFoundError");
      return `// ${path}\n`;
    }),
  };
});

function session(id: string, name = id): IdeFolderSession {
  return {
    id,
    name,
    pathLabel: name,
    handle: {} as FileSystemDirectoryHandle,
    absRoot: null,
  };
}

function reset() {
  openRecentMock.mockReset();
  useIdeStore.setState({
    session: null,
    recent: [
      { id: "fsa:a", name: "alpha", pathLabel: "alpha", lastOpenedAt: 3 },
      { id: "fsa:b", name: "beta", pathLabel: "beta", lastOpenedAt: 2 },
    ],
    tabs: [],
    activePath: null,
    children: {},
    expanded: { "": true },
    status: null,
    recentFiles: [
      {
        sessionId: "fsa:a",
        projectName: "alpha",
        path: "src/A.ts",
        openedAt: 10,
      },
      {
        sessionId: "fsa:b",
        projectName: "beta",
        path: "src/B.ts",
        openedAt: 9,
      },
    ],
  });
  // openRecent is what actually restores the folder handle; stub the I/O and
  // reproduce its state effect (session set, tabs cleared).
  useIdeStore.setState({
    openRecent: async (id: string) => {
      const ok = await openRecentMock(id);
      if (!ok) {
        useIdeStore.setState({ status: "无法恢复目录授权，请重新「打开文件夹」" });
        return false;
      }
      const meta = useIdeStore.getState().recent.find((r) => r.id === id);
      useIdeStore.setState({
        session: session(id, meta?.name ?? id),
        tabs: [],
        activePath: null,
      });
      return true;
    },
  });
}

describe("openRecentFile — no project open (welcome screen)", () => {
  beforeEach(reset);

  it("opens the project then the file", async () => {
    openRecentMock.mockResolvedValue(true);
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "src/A.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(true);
    expect(openRecentMock).toHaveBeenCalledWith("fsa:a");
    const st = useIdeStore.getState();
    expect(st.session?.id).toBe("fsa:a");
    expect(st.activePath).toBe("src/A.ts");
  });

  it("reports a reason instead of failing silently when the grant is gone", async () => {
    openRecentMock.mockResolvedValue(false);
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "src/A.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(false);
    expect(useIdeStore.getState().status).toBeTruthy();
    expect(useIdeStore.getState().status).toContain("alpha");
  });

  it("keeps a single, specific status when the project cannot reopen", async () => {
    // openRecent's own failure path prunes the project + its rows.
    useIdeStore.setState({
      openRecent: async (id: string) => {
        useIdeStore.setState((s) => ({
          status: "无法恢复目录授权，请重新「打开文件夹」",
          recent: s.recent.filter((r) => r.id !== id),
          recentFiles: s.recentFiles.filter((f) => f.sessionId !== id),
        }));
        return false;
      },
    });
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "src/A.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(false);
    const st = useIdeStore.getState();
    expect(st.status).toContain("alpha");
    expect(st.status).toContain("授权");
    // No ghost rows: the project and its files are both gone.
    expect(st.recent.some((r) => r.id === "fsa:a")).toBe(false);
    expect(st.recentFiles.some((f) => f.sessionId === "fsa:a")).toBe(false);
  });

  it("reports a reason when the row's project is no longer recent", async () => {
    useIdeStore.setState({
      recent: useIdeStore.getState().recent.filter((r) => r.id !== "fsa:a"),
    });
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "src/A.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(false);
    expect(useIdeStore.getState().status).toContain("最近工程");
    expect(openRecentMock).not.toHaveBeenCalled();
  });

  it("explains that an unlabelled row cannot pick a project", async () => {
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "",
      path: "src/A.ts",
    });
    expect(ok).toBe(false);
    expect(useIdeStore.getState().status).toBeTruthy();
  });
});

describe("openRecentFile — project already open", () => {
  beforeEach(reset);

  it("opens a file from the same project without switching", async () => {
    useIdeStore.setState({ session: session("fsa:a", "alpha") });
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "src/A.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(true);
    expect(openRecentMock).not.toHaveBeenCalled();
    expect(useIdeStore.getState().activePath).toBe("src/A.ts");
  });

  it("switches project then locates the file", async () => {
    openRecentMock.mockResolvedValue(true);
    useIdeStore.setState({ session: session("fsa:a", "alpha") });
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:b",
      path: "src/B.ts",
      projectName: "beta",
    });
    expect(ok).toBe(true);
    expect(openRecentMock).toHaveBeenCalledWith("fsa:b");
    const st = useIdeStore.getState();
    expect(st.session?.id).toBe("fsa:b");
    expect(st.activePath).toBe("src/B.ts");
  });

  it("refuses to switch while a file is dirty, with a reason", async () => {
    useIdeStore.setState({
      session: session("fsa:a", "alpha"),
      tabs: [{ path: "src/A.ts", savedContent: "x", draft: "y" }],
    });
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:b",
      path: "src/B.ts",
      projectName: "beta",
    });
    expect(ok).toBe(false);
    expect(openRecentMock).not.toHaveBeenCalled();
    expect(useIdeStore.getState().status).toContain("未保存");
  });

  it("says the project opened but the file is missing", async () => {
    openRecentMock.mockResolvedValue(true);
    const ok = await useIdeStore.getState().openRecentFile({
      sessionId: "fsa:a",
      path: "missing.ts",
      projectName: "alpha",
    });
    expect(ok).toBe(false);
    expect(useIdeStore.getState().status).toContain("missing.ts");
  });
});

describe("removeRecent — no ghost recent files", () => {
  beforeEach(reset);

  it("drops the deleted project's recent file rows", async () => {
    await useIdeStore.getState().removeRecent("fsa:a");
    const st = useIdeStore.getState();
    expect(st.recent.map((r) => r.id)).toEqual(["fsa:b"]);
    expect(st.recentFiles.map((f) => f.sessionId)).toEqual(["fsa:b"]);
  });

  it("keeps other projects' rows untouched", async () => {
    await useIdeStore.getState().removeRecent("fsa:b");
    const st = useIdeStore.getState();
    expect(st.recentFiles).toEqual([
      {
        sessionId: "fsa:a",
        projectName: "alpha",
        path: "src/A.ts",
        openedAt: 10,
      },
    ]);
  });
});
