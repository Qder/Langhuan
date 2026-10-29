import { describe, expect, it } from "vitest";
import {
  extractWikiLinks,
  findUnlinkedMentions,
  linkifyMention,
  parseWikiInner,
  rewriteWikiLinksOnRename,
  rewriteWikiLinksWithMap,
  wikiDisplayLabel,
} from "./wikilink";

describe("parseWikiInner", () => {
  it("parses target, heading, alias", () => {
    expect(parseWikiInner("欢迎")).toEqual({ target: "欢迎" });
    expect(parseWikiInner("欢迎#大纲")).toEqual({ target: "欢迎", heading: "大纲" });
    expect(parseWikiInner("欢迎|首页")).toEqual({ target: "欢迎", alias: "首页" });
    expect(parseWikiInner("欢迎#大纲|看这里")).toEqual({
      target: "欢迎",
      heading: "大纲",
      alias: "看这里",
    });
  });
});

describe("extractWikiLinks", () => {
  it("finds links and embeds with positions", () => {
    const src = "见 [[快速上手]] 与 ![[欢迎#简介]] 以及 [[方法论·双链笔记|双链]]。";
    const refs = extractWikiLinks(src);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ target: "快速上手", embed: false });
    expect(refs[1]).toMatchObject({ target: "欢迎", heading: "简介", embed: true });
    expect(refs[2]).toMatchObject({ target: "方法论·双链笔记", alias: "双链", embed: false });
    expect(src.slice(refs[0].start, refs[0].end)).toBe("[[快速上手]]");
    expect(src.slice(refs[1].start, refs[1].end)).toBe("![[欢迎#简介]]");
  });
});

describe("rewriteWikiLinksOnRename", () => {
  it("rewrites target across forms", () => {
    const src = "[[旧名]] ![[旧名#节]] [[旧名|别名]] [[别的]]";
    const { content, count } = rewriteWikiLinksOnRename(src, ["旧名"], "新名");
    expect(count).toBe(3);
    expect(content).toBe("[[新名]] ![[新名#节]] [[新名|别名]] [[别的]]");
  });
});

describe("findUnlinkedMentions + linkify", () => {
  it("skips already-linked titles", () => {
    const src = "欢迎来到琅嬛，试试打开 [[快速上手]]，再说一次快速上手。";
    const mentions = findUnlinkedMentions(src, ["快速上手", "欢迎"]);
    // 「欢迎」 in 欢迎来到 may match; 快速上手 once plain
    const quick = mentions.filter((m) => m.title === "快速上手");
    expect(quick).toHaveLength(1);
    expect(src.slice(quick[0].start, quick[0].end)).toBe("快速上手");
    const linked = linkifyMention(src, quick[0].start, quick[0].end, "快速上手");
    expect(linked).toContain("[[快速上手]]，再说一次[[快速上手]]");
  });
});

describe("wikiDisplayLabel", () => {
  it("prefers alias then heading", () => {
    expect(wikiDisplayLabel({ target: "a", alias: "x" })).toBe("x");
    expect(wikiDisplayLabel({ target: "a", heading: "h" })).toBe("a › h");
    expect(wikiDisplayLabel({ target: "a" })).toBe("a");
  });
});

describe("rewriteWikiLinksWithMap", () => {
  it("rewrites title, heading, alias, embed and keeps path style", () => {
    const src = "[[旧名]] ![[旧名#节]] [[旧名|别名]] [[folder/旧名]] [[别的]]";
    const { content, count } = rewriteWikiLinksWithMap(src, [
      {
        oldNames: ["旧名", "folder/旧名", "旧名.md"],
        newTarget: "新名",
        newPathTarget: "folder/新名",
      },
    ]);
    expect(count).toBe(4);
    expect(content).toBe(
      "[[新名]] ![[新名#节]] [[新名|别名]] [[folder/新名]] [[别的]]"
    );
  });

  it("applies multiple mappings in one pass", () => {
    const src = "[[a]] [[b]]";
    const { content, count } = rewriteWikiLinksWithMap(src, [
      { oldNames: ["a"], newTarget: "A" },
      { oldNames: ["b"], newTarget: "B" },
    ]);
    expect(count).toBe(2);
    expect(content).toBe("[[A]] [[B]]");
  });
});
