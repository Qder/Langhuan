import { describe, expect, it } from "vitest";
import { isSafPickCancelled, pickAndScanSafProject } from "./saf";

describe("isSafPickCancelled", () => {
  it("treats the system picker dismiss as cancel, not a hard error", () => {
    expect(isSafPickCancelled(new Error("已取消选择文件夹"))).toBe(true);
    expect(isSafPickCancelled("用户取消了")).toBe(true);
    expect(isSafPickCancelled(new Error("写入失败"))).toBe(false);
  });
});

describe("pickAndScanSafProject", () => {
  it("throws a clear error instead of pretending to succeed off Android", async () => {
    await expect(pickAndScanSafProject()).rejects.toThrow(/不能选择系统文件夹/);
  });
});
