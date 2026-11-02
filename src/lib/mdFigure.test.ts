/**
 * 插图判定：只有「一整段就一张图、且写了 alt」才变成 figure + 图注。
 * 混排（文字里夹一张图）保持行内 —— 那种图不该抢一整段。
 */
import { describe, expect, it } from "vitest";
import * as React from "react";
import { normalizeCaption, soleImageCaption } from "./mdFigure";

const img = (alt?: string, src = "a.png") => React.createElement("img", { src, alt });

describe("normalizeCaption", () => {
  it("首尾空白、换行都压平", () => {
    expect(normalizeCaption("  一张图\n说明  ")).toBe("一张图 说明");
  });

  it("空 / 纯空白 / 非字符串 → 没有图注", () => {
    expect(normalizeCaption("")).toBeNull();
    expect(normalizeCaption("   \n ")).toBeNull();
    expect(normalizeCaption(undefined)).toBeNull();
    expect(normalizeCaption(42)).toBeNull();
  });
});

describe("soleImageCaption", () => {
  it("段落里只有一张带 alt 的图 → 返回图注", () => {
    expect(soleImageCaption([img("藏书阁 平面图")])).toBe("藏书阁 平面图");
  });

  it("换行符之类的空白文本节点不算「多一个孩子」", () => {
    expect(soleImageCaption(["", img("图注"), "\n"])).toBe("图注");
  });

  it("没有 alt 的图不生成空图注", () => {
    expect(soleImageCaption([img("")])).toBeNull();
    expect(soleImageCaption([img()])).toBeNull();
  });

  it("文字 + 图混排 → 不抢整段", () => {
    expect(soleImageCaption(["前面的话", img("图注")])).toBeNull();
  });

  it("两张图 → 各自随便，不做插图", () => {
    expect(soleImageCaption([img("甲"), img("乙")])).toBeNull();
  });

  it("没有 alt 属性的元素（wiki 胶囊 / 行内代码）不会被误判", () => {
    expect(soleImageCaption([React.createElement("span", { className: "wiki-link" }, "某篇")])).toBeNull();
    expect(soleImageCaption([React.createElement("code", null, "npm i")])).toBeNull();
  });

  it("空段落 → null", () => {
    expect(soleImageCaption([])).toBeNull();
    expect(soleImageCaption(null)).toBeNull();
  });
});
