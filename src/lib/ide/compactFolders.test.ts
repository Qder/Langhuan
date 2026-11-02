import { describe, expect, it } from "vitest";
import type { IdeFsEntry } from "./ideFs";
import {
  childrenLookupFromMap,
  compactFolderChain,
} from "./compactFolders";

function dir(path: string): IdeFsEntry {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return { name, path, kind: "directory" };
}

function file(path: string): IdeFsEntry {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return { name, path, kind: "file" };
}

describe("compactFolderChain", () => {
  it("collapses A/B/C when each has exactly one child directory", () => {
    const map: Record<string, IdeFsEntry[]> = {
      a: [dir("a/b")],
      "a/b": [dir("a/b/c")],
      "a/b/c": [dir("a/b/c/aspect"), dir("a/b/c/controller")],
    };
    const chain = compactFolderChain(dir("a"), childrenLookupFromMap(map));
    expect(chain.label).toBe("a/b/c");
    expect(chain.segments).toEqual(["a", "b", "c"]);
    expect(chain.paths).toEqual(["a", "a/b", "a/b/c"]);
    expect(chain.leafPath).toBe("a/b/c");
    expect(chain.needsList).toBeNull();
  });

  it("does not compact when a folder has two directory children", () => {
    const map: Record<string, IdeFsEntry[]> = {
      a: [dir("a/b"), dir("a/c")],
    };
    const chain = compactFolderChain(dir("a"), childrenLookupFromMap(map));
    expect(chain.label).toBe("a");
    expect(chain.leafPath).toBe("a");
    expect(chain.segments).toEqual(["a"]);
    expect(chain.needsList).toBeNull();
  });

  it("does not compact when a folder has a file sibling", () => {
    const map: Record<string, IdeFsEntry[]> = {
      a: [dir("a/b"), file("a/README.md")],
    };
    const chain = compactFolderChain(dir("a"), childrenLookupFromMap(map));
    expect(chain.label).toBe("a");
    expect(chain.leafPath).toBe("a");
    expect(chain.needsList).toBeNull();
  });

  it("stops before a sole file child (folder stays, file is not a segment)", () => {
    const map: Record<string, IdeFsEntry[]> = {
      a: [dir("a/b")],
      "a/b": [file("a/b/Main.java")],
    };
    const chain = compactFolderChain(dir("a"), childrenLookupFromMap(map));
    expect(chain.label).toBe("a/b");
    expect(chain.leafPath).toBe("a/b");
    expect(chain.needsList).toBeNull();
  });

  it("reports needsList when the next directory is not listed yet", () => {
    const map: Record<string, IdeFsEntry[]> = {
      a: [dir("a/b")],
      // a/b not listed
    };
    const chain = compactFolderChain(dir("a"), childrenLookupFromMap(map));
    expect(chain.label).toBe("a/b");
    expect(chain.leafPath).toBe("a/b");
    expect(chain.needsList).toBe("a/b");
  });

  it("compacts through an empty leaf directory", () => {
    const map: Record<string, IdeFsEntry[]> = {
      java: [dir("java/com")],
      "java/com": [dir("java/com/demo")],
      "java/com/demo": [],
    };
    const chain = compactFolderChain(dir("java"), childrenLookupFromMap(map));
    expect(chain.label).toBe("java/com/demo");
    expect(chain.leafPath).toBe("java/com/demo");
    expect(chain.needsList).toBeNull();
  });
});
