import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIdeStore } from "./store";
import type { IdeFolderSession } from "./ideFs";

vi.mock("./ideFs", async () => {
  const actual = await vi.importActual<typeof import("./ideFs")>("./ideFs");
  return {
    ...actual,
    listIdeDir: vi.fn(async (_session: IdeFolderSession, relDir: string) => {
      if (relDir === "") {
        return [{ name: "src", path: "src", kind: "directory" as const }];
      }
      if (relDir === "src") {
        return [{ name: "A.java", path: "src/A.java", kind: "file" as const }];
      }
      return [];
    }),
    readIdeFile: vi.fn(async () => "line1\nline2\nline3\nline4\n"),
  };
});

const fakeSession: IdeFolderSession = {
  id: "test-session",
  name: "demo",
  pathLabel: "demo",
  handle: {} as FileSystemDirectoryHandle,
  absRoot: null,
};

describe("openFile pendingReveal + explorer reveal", () => {
  beforeEach(() => {
    useIdeStore.setState({
      session: fakeSession,
      tabs: [
        {
          path: "src/A.java",
          savedContent: "line1\nline2\nline3\nline4\n",
          draft: "line1\nline2\nline3\nline4\n",
        },
      ],
      activePath: "src/A.java",
      pendingReveal: { path: "src/A.java", line: 1 },
      expanded: { "": true },
      children: {
        "": [{ name: "src", path: "src", kind: "directory" }],
      },
      status: null,
    });
  });

  it("re-open same tab refreshes pendingReveal line", async () => {
    const ok = await useIdeStore.getState().openFile("src/A.java", { line: 3 });
    expect(ok).toBe(true);
    expect(useIdeStore.getState().pendingReveal).toEqual({
      path: "src/A.java",
      line: 3,
    });
    expect(useIdeStore.getState().activePath).toBe("src/A.java");
  });

  it("marks ancestor dirs expanded after open", async () => {
    await useIdeStore.getState().openFile("src/A.java", { line: 2 });
    const { expanded } = useIdeStore.getState();
    expect(expanded[""]).toBe(true);
    expect(expanded["src"]).toBe(true);
  });

  it("deep path expands ancestors and sets pendingExplorerReveal", async () => {
    useIdeStore.setState({
      tabs: [
        {
          path: "src/a/b/Foo.java",
          savedContent: "class Foo {}",
          draft: "class Foo {}",
        },
      ],
      activePath: null,
      expanded: { "": true },
      children: { "": [{ name: "src", path: "src", kind: "directory" }] },
      pendingExplorerReveal: null,
      explorerOpen: false,
    });
    const ok = await useIdeStore.getState().openFile("src/a/b/Foo.java");
    expect(ok).toBe(true);
    const st = useIdeStore.getState();
    expect(st.expanded["src"]).toBe(true);
    expect(st.expanded["src/a"]).toBe(true);
    expect(st.expanded["src/a/b"]).toBe(true);
    expect(st.explorerOpen).toBe(true);
    expect(st.pendingExplorerReveal?.path).toBe("src/a/b/Foo.java");
    expect(typeof st.pendingExplorerReveal?.nonce).toBe("number");
  });
});
