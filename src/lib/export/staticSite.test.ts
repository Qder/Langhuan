import { describe, expect, it } from "vitest";
import { buildStaticSiteZip } from "./staticSite";
import type { Document } from "../types";
import JSZip from "jszip";

const docs: Document[] = [
  {
    id: "a",
    path: "欢迎.md",
    type: "md",
    content: "# Hi\n\nhello",
    starred: false,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "b",
    path: "页/demo.html",
    type: "html",
    content: "<!DOCTYPE html><html><body>X</body></html>",
    starred: false,
    createdAt: 1,
    updatedAt: 1,
  },
];

describe("buildStaticSiteZip", () => {
  it("includes index and html pages", async () => {
    const blob = await buildStaticSiteZip({ documents: docs });
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.endsWith("index.html"))).toBe(true);
    expect(names.some((n) => n.includes("欢迎.html"))).toBe(true);
    expect(names.some((n) => n.includes("demo.html"))).toBe(true);
  });
});
