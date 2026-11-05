/**
 * 讲解面板的静态契约（不挂 React 运行时，只读源码）。
 *
 * 这些断言来自一次 hooks 清理：三条 React Compiler 规则（refs / purity /
 * set-state-in-effect）报出来的写法都被换掉了，这里钉住「别再写回去」，
 * 同时钉住换写法时最容易丢的行为细节。
 *
 * 面板拆分后规则落在对应 hook 文件里，不回到 IdeExplainPanel.tsx 编排层。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "src/components/ide");
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const panel = read("IdeExplainPanel.tsx");
const sendSrc = read("explain/useExplainSend.ts");
const pendingSrc = read("explain/usePendingExplain.ts");
const hintSrc = read("explain/ExplainDesktopHint.tsx");
const composerSrc = read("explain/ExplainComposer.tsx");

describe("讲解面板：编排层够瘦", () => {
  it("主文件只编排，不内联 markdown / 流式 / pending", () => {
    expect(panel).toContain('from "./explain/ExplainMessageList"');
    expect(panel).toContain('from "./explain/ExplainComposer"');
    expect(panel).toContain('from "./explain/usePendingExplain"');
    expect(panel).not.toContain("ReactMarkdown");
    expect(panel).not.toContain("streamExplain(");
    expect(panel.split(/\r?\n/).length).toBeLessThan(160);
  });
});

describe("讲解面板：React Compiler 规则", () => {
  it("渲染阶段不写 ref（react-hooks/refs）", () => {
    const effect =
      /React\.useEffect\(\(\) => \{\s*sendRef\.current = send;\s*\}\);/;
    expect(sendSrc).toMatch(effect);
    expect(sendSrc.replace(effect, "")).not.toMatch(/sendRef\.current\s*=/);
    expect(panel).not.toMatch(/sendRef\.current\s*=/);
  });

  it("时间戳只在事件路径里打（react-hooks/purity）", () => {
    const between = sendSrc.slice(
      sendSrc.indexOf("const send = async ("),
      sendSrc.indexOf("sendRef.current = send")
    );
    expect(between).toContain("Date.now()");
    const preamble = sendSrc.slice(
      sendSrc.indexOf("export function useExplainSend"),
      sendSrc.indexOf("const send = async (")
    );
    expect(preamble).not.toMatch(/Date\.now\(\)/);
  });

  it("pendingExplainRequest 的 effect 里不 setState（set-state-in-effect）", () => {
    const effect = pendingSrc.match(
      /React\.useEffect\(\(\) => \{\s*const req = pendingExplainRequest[\s\S]*?\}, \[pendingExplainRequest, clearPendingExplainRequest, sendRef\]\);/
    );
    expect(effect).toBeTruthy();
    expect(effect![0]).not.toContain("setIncludeFile(");
    expect(effect![0]).not.toContain("setIncludeSelection(");
  });

  it("「讲解选区」请求不会重复发送", () => {
    expect(pendingSrc).toContain("handledRequestNonceRef");
    expect(pendingSrc).toMatch(
      /handledRequestNonceRef\.current === req\.nonce|req\.nonce === handledRequestNonceRef\.current/
    );
  });

  it("勾选项仍然跟随「讲解选区」请求", () => {
    expect(pendingSrc).toMatch(/setIncludeFile\(pendingExplainRequest\.includeFile\)/);
    expect(pendingSrc).toMatch(
      /setIncludeSelection\(pendingExplainRequest\.includeSelection\)/
    );
  });
});

describe("讲解面板：输入区 Enter 发送", () => {
  it("走 composerKeys，不把裸 Enter 绑成只认 Ctrl/⌘", () => {
    expect(composerSrc).toContain("shouldSendOnExplainComposerKey");
    expect(composerSrc).toContain("Enter 发送 · Shift+Enter 换行");
    expect(composerSrc).not.toMatch(
      /if \(e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)\)/
    );
  });

  it("busy 或空内容时不调用 onSend", () => {
    expect(composerSrc).toMatch(/if \(busy \|\| !question\.trim\(\)\) return;/);
  });

  it("消息列表与 composer 有比 1px chrome-border 更明显的顶边", () => {
    expect(composerSrc).toContain("border-t-2");
    expect(composerSrc).not.toMatch(
      /className="shrink-0 border-t border-\[var\(--chrome-border\)\]/
    );
  });
});

describe("讲解面板：桌面通路", () => {
  it("走 streamExplain，设置里才出现桌面说明", () => {
    expect(sendSrc).toContain('from "@/lib/ide/explainClient"');
    expect(sendSrc).toContain("streamExplain(");
    expect(sendSrc).not.toContain("桌面版不支持 IDE 讲解");
    expect(sendSrc).not.toContain("TAURI_EXPLAIN_UNAVAILABLE");
    expect(sendSrc).not.toMatch(/fetch\(\s*["']\/api\/ide\/explain["']/);
    expect(hintSrc).toContain("TAURI_EXPLAIN_HINT");
    expect(hintSrc).toContain("isTauriRuntime");
  });
});
