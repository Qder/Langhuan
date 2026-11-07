import { describe, expect, it } from "vitest";
import { isSafPickCancelled } from "./saf";

describe("isSafPickCancelled", () => {
  it("treats the system picker dismiss as cancel, not a hard error", () => {
    expect(isSafPickCancelled(new Error("已取消选择文件夹"))).toBe(true);
    expect(isSafPickCancelled("用户取消了")).toBe(true);
    expect(isSafPickCancelled(new Error("写入失败"))).toBe(false);
  });
});
