/**
 * The persisted half of Notes → 读码 links: what survives a reload, and what
 * the welcome banner can tell the user about it.
 */
import { describe, expect, it } from "vitest";
import {
  guessPendingProject,
  normalizePendingIdeLink,
  pendingLinkLocation,
} from "./pendingLink";

describe("normalizePendingIdeLink", () => {
  it("keeps a path + line target as written", () => {
    expect(normalizePendingIdeLink({ path: "src/App.tsx", line: 10 })).toEqual({
      path: "src/App.tsx",
      line: 10,
    });
  });

  it("normalizes separators and drops a leading ./", () => {
    expect(
      normalizePendingIdeLink({ path: ".\\src\\App.tsx", line: 10 })
    ).toEqual({ path: "src/App.tsx", line: 10 });
  });

  it("keeps a sane end line and drops a backwards one", () => {
    expect(
      normalizePendingIdeLink({ path: "src/A.ts", line: 4, endLine: 9 })
    ).toEqual({ path: "src/A.ts", line: 4, endLine: 9 });
    expect(
      normalizePendingIdeLink({ path: "src/A.ts", line: 9, endLine: 4 })
    ).toEqual({ path: "src/A.ts", line: 9 });
  });

  it("falls back to path-only when the line is unusable", () => {
    expect(
      normalizePendingIdeLink({ path: "src/A.ts", line: 0 })
    ).toEqual({ path: "src/A.ts" });
    expect(
      normalizePendingIdeLink({ path: "src/A.ts", line: "10" })
    ).toEqual({ path: "src/A.ts" });
  });

  it("rejects garbage and non-file targets", () => {
    expect(normalizePendingIdeLink(null)).toBeNull();
    expect(normalizePendingIdeLink("src/A.ts")).toBeNull();
    expect(normalizePendingIdeLink({})).toBeNull();
    expect(normalizePendingIdeLink({ path: "   " })).toBeNull();
    // Package-style name: dots but no slash.
    expect(normalizePendingIdeLink({ path: "java.util.List" })).toBeNull();
    expect(normalizePendingIdeLink({ path: "https://x.dev/a.ts" })).toBeNull();
  });
});

describe("pendingLinkLocation", () => {
  it("spells out the line instead of the ide: scheme", () => {
    expect(pendingLinkLocation({ path: "src/App.tsx", line: 10 })).toBe(
      "src/App.tsx · 第 10 行"
    );
  });

  it("shows a range when the link has one", () => {
    expect(
      pendingLinkLocation({ path: "src/App.tsx", line: 10, endLine: 14 })
    ).toBe("src/App.tsx · 第 10–14 行");
  });

  it("shows only the path without a line", () => {
    expect(pendingLinkLocation({ path: "src/App.tsx" })).toBe("src/App.tsx");
  });
});

describe("guessPendingProject", () => {
  const recent = [
    { id: "fsa:alpha", name: "alpha", pathLabel: "/work/alpha" },
    { id: "fsa:beta", name: "beta", pathLabel: "/work/beta" },
  ];

  it("picks the project the file was last opened from", () => {
    expect(
      guessPendingProject({ path: "src/App.tsx", line: 10 }, [
        { sessionId: "fsa:alpha", path: "src/A.ts" },
        { sessionId: "fsa:beta", path: "src/App.tsx" },
      ], recent)
    ).toEqual({ id: "fsa:beta", name: "beta", pathLabel: "/work/beta" });
  });

  it("matches on a normalized path", () => {
    expect(
      guessPendingProject({ path: "src/App.tsx" }, [
        { sessionId: "fsa:alpha", path: "./src\\App.tsx" },
      ], recent)?.id
    ).toBe("fsa:alpha");
  });

  it("returns null when no row matches or the project is gone", () => {
    expect(guessPendingProject({ path: "src/Nope.ts" }, [], recent)).toBeNull();
    expect(
      guessPendingProject({ path: "src/App.tsx" }, [
        { sessionId: "fsa:deleted", path: "src/App.tsx" },
      ], recent)
    ).toBeNull();
  });
});
