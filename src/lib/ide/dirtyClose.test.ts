import { describe, expect, it } from "vitest";
import { resolveDirtyClose, shouldBlockDirtyClose } from "./dirtyClose";

describe("dirty close", () => {
  it("blocks only when dirty", () => {
    expect(shouldBlockDirtyClose(true)).toBe(true);
    expect(shouldBlockDirtyClose(false)).toBe(false);
  });

  it("resolves choices", () => {
    expect(resolveDirtyClose("save")).toEqual({
      proceed: true,
      saveFirst: true,
      discard: false,
    });
    expect(resolveDirtyClose("discard")).toEqual({
      proceed: true,
      saveFirst: false,
      discard: true,
    });
    expect(resolveDirtyClose("cancel")).toEqual({
      proceed: false,
      saveFirst: false,
      discard: false,
    });
  });
});
