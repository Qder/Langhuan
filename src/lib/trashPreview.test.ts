import { describe, expect, it } from "vitest";
import { trashPreviewBody, TRASH_PREVIEW_MAX_LINES } from "./trashPreview";

describe("trashPreviewBody", () => {
  it("truncates to ≤40 lines and keeps the start", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1} 正文开头`);
    lines[0] = "# 标题开头";
    const body = trashPreviewBody(lines.join("\n"), "md");
    expect(body.kind).toBe("md");
    if (body.kind === "empty") throw new Error("expected text");
    expect(body.truncated).toBe(true);
    expect(body.lineCount).toBe(TRASH_PREVIEW_MAX_LINES);
    expect(body.text.startsWith("# 标题开头")).toBe(true);
    expect(body.text.split("\n").length).toBeLessThanOrEqual(TRASH_PREVIEW_MAX_LINES + 1); // +ellipsis line
    expect(body.text).toContain("…");
    expect(body.text).not.toContain("L50");
  });

  it("empty content → 无正文 branch", () => {
    expect(trashPreviewBody("", "md")).toEqual({
      kind: "empty",
      message: "无正文可预览",
    });
    expect(trashPreviewBody("   \n  ", "html").kind).toBe("empty");
  });

  it("short content is not truncated", () => {
    const body = trashPreviewBody("hello\nworld", "html");
    expect(body.kind).toBe("html");
    if (body.kind === "empty") throw new Error("expected text");
    expect(body.truncated).toBe(false);
    expect(body.text).toBe("hello\nworld");
  });
});
