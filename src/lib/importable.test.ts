import { describe, expect, it } from "vitest";
import {
  isImportableImagePath,
  isImportableLibraryPath,
  libraryDocTypeFromPath,
  mimeForImportableImage,
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

  it("accepts common raster image paths for asset import", () => {
    expect(isImportableImagePath("figs/01.png")).toBe(true);
    expect(isImportableImagePath("a.JPG")).toBe(true);
    expect(isImportableImagePath("a.jpeg")).toBe(true);
    expect(isImportableImagePath("x.gif")).toBe(true);
    expect(isImportableImagePath("x.webp")).toBe(true);
    expect(isImportableImagePath("x.bmp")).toBe(true);
    expect(isImportableImagePath("x.avif")).toBe(true);
    expect(isImportableImagePath("note.md")).toBe(false);
    expect(isImportableImagePath("seal.svg")).toBe(false);
  });

  it("maps svg to html type and keeps path", () => {
    expect(libraryDocTypeFromPath("assets/seal.svg")).toBe("html");
    expect(libraryDocTypeFromPath("a.md")).toBe("md");
    expect(normalizeImportedPath("x.txt")).toBe("x.md");
    expect(normalizeImportedPath("assets/seal.svg")).toBe("assets/seal.svg");
  });

  it("derives mime from file type or extension", () => {
    expect(mimeForImportableImage("a.png", "image/png")).toBe("image/png");
    expect(mimeForImportableImage("figs/01.JPG", "")).toBe("image/jpeg");
    expect(mimeForImportableImage("x.webp")).toBe("image/webp");
  });
});
