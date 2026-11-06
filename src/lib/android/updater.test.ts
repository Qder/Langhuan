import { describe, expect, it } from "vitest";
import {
  explainAndroidUpdaterError,
  isNewerAndroidBuild,
  parseAndroidLatestManifest,
} from "./updater";

describe("parseAndroidLatestManifest", () => {
  it("accepts a valid manifest", () => {
    const m = parseAndroidLatestManifest({
      versionCode: 3,
      versionName: "0.1.1",
      notes: "修安卓更新",
      apkUrl: "https://example.com/a.apk",
      sha256: "a".repeat(64),
    });
    expect(m.versionCode).toBe(3);
    expect(m.sha256).toHaveLength(64);
  });

  it("rejects bad sha", () => {
    expect(() =>
      parseAndroidLatestManifest({
        versionCode: 2,
        versionName: "0.1.0",
        apkUrl: "https://x/a.apk",
        sha256: "zz",
      })
    ).toThrow(/sha256/);
  });
});

describe("isNewerAndroidBuild", () => {
  it("compares versionCode only", () => {
    expect(isNewerAndroidBuild(3, 2)).toBe(true);
    expect(isNewerAndroidBuild(2, 2)).toBe(false);
    expect(isNewerAndroidBuild(1, 2)).toBe(false);
  });
});

describe("explainAndroidUpdaterError", () => {
  it("maps unknown sources", () => {
    expect(
      explainAndroidUpdaterError(
        new Error("UNKNOWN_SOURCES:需要允许「安装未知应用」。已打开系统设置")
      )
    ).toMatch(/安装未知应用/);
  });

  it("maps sha mismatch", () => {
    expect(
      explainAndroidUpdaterError(new Error("更新包校验失败（sha256 不匹配）"))
    ).toMatch(/校验失败/);
  });

  it("maps network", () => {
    expect(explainAndroidUpdaterError(new Error("network timeout"))).toMatch(
      /连不上更新服务器/
    );
  });

  it("maps missing GitHub asset, not as a generic connect error", () => {
    expect(
      explainAndroidUpdaterError(
        new Error("找不到更新清单。可能还没有发布过安装包。")
      )
    ).toMatch(/找不到更新清单/);
    expect(
      explainAndroidUpdaterError(new Error("连不上更新服务器：HTTP 404"))
    ).toMatch(/找不到更新清单/);
  });
});
