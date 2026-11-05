import { describe, expect, it } from "vitest";
import { explainUpdaterError } from "./updater";

describe("explainUpdaterError", () => {
  it("maps signature failures", () => {
    expect(explainUpdaterError(new Error("failed to verify minisign signature"))).toMatch(
      /签名校验失败/
    );
  });

  it("maps network failures", () => {
    expect(explainUpdaterError(new Error("error sending request for url: dns"))).toMatch(
      /连不上更新服务器/
    );
    expect(explainUpdaterError(new Error("timed out"))).toMatch(/连不上更新服务器/);
  });

  it("maps missing manifest", () => {
    expect(explainUpdaterError(new Error("404 Not Found"))).toMatch(/找不到更新清单/);
  });

  it("falls back to a short Chinese line", () => {
    expect(explainUpdaterError(new Error("weird boom"))).toMatch(/^检查更新失败：/);
  });
});
