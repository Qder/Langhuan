import { describe, expect, it } from "vitest";
import {
  isImportableLibraryPath,
  libraryDocTypeFromPath,
  normalizeImportedPath,
} from "./importable";

describe("importable", () => {
  it("accepts md/html/txt/svg", () => {
    expect(isImportableLibraryPath("a.md")).toBe(true);
    expect(isImportableLibraryPath("a.HTML")).toBe(true);
    expect(isImportableLibraryPath("note.txt")).toBe(true);
    expect(isImportableLibraryPath("assets/seal.svg")).toBe(true);
    expect(isImportableLibraryPath("x.png")).toBe(false);
  });

  it("maps svg to html type and keeps path", () => {
    expect(libraryDocTypeFromPath("assets/seal.svg")).toBe("html");
    expect(libraryDocTypeFromPath("a.md")).toBe("md");
    expect(normalizeImportedPath("x.txt")).toBe("x.md");
    expect(normalizeImportedPath("assets/seal.svg")).toBe("assets/seal.svg");
  });
});
