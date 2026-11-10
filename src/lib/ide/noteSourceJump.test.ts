import { describe, expect, it } from "vitest";
import { buildNoteSourceCitation } from "./noteSourceCitation";
import { resolveNoteSourceJump, type CitationProjectIo } from "./noteSourceJump";

const citation = buildNoteSourceCitation({
  projectId: "p1",
  path: "src/foo.ts",
  fromLine: 2,
  toLine: 4,
  snapshot: "function target() {\n  return 42;\n}",
  capturedAt: 1,
});

const originalFile = [
  "const a = 1;",
  "function target() {",
  "  return 42;",
  "}",
  "const b = 2;",
].join("\n");

function filesIo(files: Record<string, string>): {
  readFile: (path: string) => Promise<string | null>;
  searchProject: CitationProjectIo;
} {
  const readFile = async (path: string) =>
    Object.prototype.hasOwnProperty.call(files, path) ? files[path]! : null;
  const searchProject: CitationProjectIo = {
    readFile,
    listDir: async (dir) => {
      const prefix = dir ? `${dir}/` : "";
      const names = new Set<string>();
      const entries: Array<{ name: string; path: string; kind: "file" | "directory" }> = [];
      for (const path of Object.keys(files)) {
        if (prefix && !path.startsWith(prefix)) continue;
        if (!prefix && path.includes("/")) {
          const top = path.slice(0, path.indexOf("/"));
          if (names.has(top)) continue;
          names.add(top);
          entries.push({ name: top, path: top, kind: "directory" });
          continue;
        }
        const rest = prefix ? path.slice(prefix.length) : path;
        if (!rest || rest.includes("/")) {
          if (!rest) continue;
          const top = rest.slice(0, rest.indexOf("/"));
          if (names.has(top)) continue;
          names.add(top);
          entries.push({ name: top, path: `${prefix}${top}`, kind: "directory" });
          continue;
        }
        entries.push({ name: rest, path, kind: "file" });
      }
      return entries;
    },
  };
  return { readFile, searchProject };
}

describe("resolveNoteSourceJump", () => {
  it("jumps to the stored range when the file is unchanged", async () => {
    const io = filesIo({ "src/foo.ts": originalFile });
    const r = await resolveNoteSourceJump({
      citation,
      readFile: io.readFile,
    });
    expect(r).toEqual({
      ok: true,
      path: "src/foo.ts",
      fromLine: 2,
      toLine: 4,
      relocated: false,
    });
  });

  it("relocates when the snippet moved inside the same file", async () => {
    const moved = [
      "const prelude = 0;",
      "const a = 1;",
      "const b = 2;",
      "function target() {",
      "  return 42;",
      "}",
    ].join("\n");
    const io = filesIo({ "src/foo.ts": moved });
    const r = await resolveNoteSourceJump({
      citation,
      readFile: io.readFile,
    });
    expect(r).toEqual({
      ok: true,
      path: "src/foo.ts",
      fromLine: 4,
      toLine: 6,
      relocated: true,
    });
  });

  it("relocates when the file moved in the project", async () => {
    const io = filesIo({
      "lib/moved.ts": originalFile,
    });
    const r = await resolveNoteSourceJump({
      citation,
      readFile: io.readFile,
      searchProject: io.searchProject,
    });
    expect(r).toEqual({
      ok: true,
      path: "lib/moved.ts",
      fromLine: 2,
      toLine: 4,
      relocated: true,
    });
  });

  it("falls back to the saved snapshot when the snippet is gone", async () => {
    const io = filesIo({
      "src/foo.ts": "const a = 1;\nconst b = 2;\n",
      "src/other.ts": "export const x = 1;\n",
    });
    const r = await resolveNoteSourceJump({
      citation,
      readFile: io.readFile,
      searchProject: io.searchProject,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.showSnapshot).toBe(true);
      expect(r.reason).toBe("not-found");
    }
  });
});
