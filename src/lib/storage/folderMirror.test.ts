import { describe, expect, it } from "vitest";
import { getMirrorBackend } from "./folderMirror";

describe("getMirrorBackend", () => {
  it("is null in unit tests (no FSA, not Tauri Android)", () => {
    expect(getMirrorBackend()).toBeNull();
  });
});
