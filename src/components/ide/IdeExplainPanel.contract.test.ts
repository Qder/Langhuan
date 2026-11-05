/**
 * 讲解面板的静态契约（不挂 React 运行时，只读源码）。
 *
 * 这些断言来自一次 hooks 清理：三条 React Compiler 规则（refs / purity /
 * set-state-in-effect）报出来的写法都被换掉了，这里钉住「别再写回去」，
 * 同时钉住换写法时最容易丢的行为细节。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/components/ide/IdeExplainPanel.tsx"),
  "utf8"
);

describe("讲解面板：React Compiler 规则", () => {
  it("渲染阶段不写 ref（react-hooks/refs）", () => {
    // 合法写法：ref 赋值是 effect 体的一部分。
    const effect =
      /React\.useEffect\(\(\) => \{\s*sendRef\.current = send;\s*\}\);/;
    expect(src).toMatch(effect);
    // 把那段 effect 抠掉后，整个文件不该再有别处写 sendRef.current。
    expect(src.replace(effect, "")).not.toMatch(/sendRef\.current\s*=/);
  });

  it("时间戳只在事件路径里打（react-hooks/purity）", () => {
    // send() 是事件处理器；render 作用域里不允许出现 Date.now()。
    const between = src.slice(
      src.indexOf("const send = async ("),
      src.indexOf("sendRef.current = send")
    );
    expect(between).toContain("Date.now()");
    // 组件体顶端到 send 定义之间不应有裸 Date.now()
    const preamble = src.slice(src.indexOf("export function IdeExplainPanel"), src.indexOf("const send = async ("));
    expect(preamble).not.toMatch(/Date\.now\(\)/);
  });

  it("pendingExplainRequest 的 effect 里不 setState（set-state-in-effect）", () => {
    const effect = src.match(
      /React\.useEffect\(\(\) => \{\s*const req = pendingExplainRequest[\s\S]*?\}, \[pendingExplainRequest, clearPendingExplainRequest\]\);/
    );
    expect(effect).toBeTruthy();
    expect(effect![0]).not.toContain("setIncludeFile(");
    expect(effect![0]).not.toContain("setIncludeSelection(");
  });

  it("「讲解选区」请求不会重复发送", () => {
    // clearPendingExplainRequest() 会让 effect 立刻再跑一次；没有 nonce
    // 去重就会发两条同样的问题（真机撞到过）。
    expect(src).toContain("handledRequestNonceRef");
    expect(src).toMatch(
      /handledRequestNonceRef\.current === req\.nonce|req\.nonce === handledRequestNonceRef\.current/
    );
  });

  it("勾选项仍然跟随「讲解选区」请求", () => {
    expect(src).toMatch(/setIncludeFile\(pendingExplainRequest\.includeFile\)/);
    expect(src).toMatch(
      /setIncludeSelection\(pendingExplainRequest\.includeSelection\)/
    );
  });
});
