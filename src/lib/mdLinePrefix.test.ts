import { describe, expect, it } from "vitest";
import {
  LIST_INDENT_STEP,
  continueLinePrefix,
  indentLinePrefix,
  matchLinePrefix,
} from "./mdLinePrefix";

describe("matchLinePrefix", () => {
  it("认识无序 / 有序 / 引用三种行首", () => {
    expect(matchLinePrefix("- item")).toMatchObject({
      kind: "bullet",
      marker: "-",
      indent: "",
      rest: "item",
    });
    expect(matchLinePrefix("* item")).toMatchObject({ kind: "bullet", marker: "*" });
    expect(matchLinePrefix("1. item")).toMatchObject({
      kind: "ordered",
      marker: "1.",
      rest: "item",
    });
    expect(matchLinePrefix("> quote")).toMatchObject({
      kind: "quote",
      marker: ">",
      rest: "quote",
    });
  });

  it("保留缩进与任务列表的框", () => {
    const p = matchLinePrefix("  - [x] 做完的");
    expect(p).toMatchObject({ indent: "  ", marker: "-", task: "[x] ", rest: "做完的" });
  });

  it("普通正文、`**加粗**` 行首、`#` 标题都不算", () => {
    expect(matchLinePrefix("普通一行")).toBeNull();
    // 有意不做行内标记展开：`**` 不该被当成列表项
    expect(matchLinePrefix("**加粗**开头")).toBeNull();
    expect(matchLinePrefix("## 标题")).toBeNull();
    expect(matchLinePrefix("-没有空格")).toBeNull();
  });
});

describe("continueLinePrefix —— 回车续行", () => {
  it("无序列表沿用原符号，不会突然变另一种点", () => {
    expect(continueLinePrefix("- a")).toEqual({ kind: "continue", insert: "\n- " });
    expect(continueLinePrefix("* a")).toEqual({ kind: "continue", insert: "\n* " });
    expect(continueLinePrefix("+ a")).toEqual({ kind: "continue", insert: "\n+ " });
  });

  it("有序列表把序号加一，且保留 1. / 1) 的分隔符", () => {
    expect(continueLinePrefix("1. a")).toEqual({ kind: "continue", insert: "\n2. " });
    expect(continueLinePrefix("9. a")).toEqual({ kind: "continue", insert: "\n10. " });
    expect(continueLinePrefix("3) a")).toEqual({ kind: "continue", insert: "\n4) " });
  });

  it("缩进跟着走（嵌套列表续行仍在同一层）", () => {
    expect(continueLinePrefix("  - a")).toEqual({ kind: "continue", insert: "\n  - " });
    expect(continueLinePrefix("  > q")).toEqual({ kind: "continue", insert: "\n  > " });
  });

  it("缩进 4 格是代码块，不当成列表 / 引用续行", () => {
    // CommonMark：4 空格缩进是 indented code，里面的 `- x` 只是代码。
    expect(continueLinePrefix("    - x")).toBeNull();
    expect(continueLinePrefix("    > x")).toBeNull();
  });

  it("任务列表续成未勾选，避免凭空多出一个已完成的项", () => {
    expect(continueLinePrefix("- [x] done")).toEqual({
      kind: "continue",
      insert: "\n- [ ] ",
    });
    expect(continueLinePrefix("- [ ] todo")).toEqual({
      kind: "continue",
      insert: "\n- [ ] ",
    });
  });

  it("引用续 `>`", () => {
    expect(continueLinePrefix("> 一句话")).toEqual({ kind: "continue", insert: "\n> " });
  });

  it("空项再回车是 clear —— 否则永远退不出列表", () => {
    expect(continueLinePrefix("- ")).toEqual({ kind: "clear" });
    expect(continueLinePrefix("1. ")).toEqual({ kind: "clear" });
    expect(continueLinePrefix("> ")).toEqual({ kind: "clear" });
    expect(continueLinePrefix("  -   ")).toEqual({ kind: "clear" });
    expect(continueLinePrefix("- [ ] ")).toEqual({ kind: "clear" });
  });

  it("普通行返回 null，交还给编辑器的默认换行", () => {
    expect(continueLinePrefix("普通一行")).toBeNull();
    expect(continueLinePrefix("")).toBeNull();
  });
});

describe("indentLinePrefix", () => {
  it("列表 / 引用行按 Tab 缩进两格", () => {
    expect(indentLinePrefix("- a")).toBe(`${LIST_INDENT_STEP}- a`);
    expect(indentLinePrefix("> q")).toBe(`${LIST_INDENT_STEP}> q`);
  });

  it("非列表行返回 null（保留编辑器自己的 Tab 语义）", () => {
    expect(indentLinePrefix("普通")).toBeNull();
  });
});
