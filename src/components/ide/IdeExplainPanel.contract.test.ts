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
const panelSrc = panel;
const sendSrc = read("explain/useExplainSend.ts");
const pendingSrc = read("explain/usePendingExplain.ts");
const hintSrc = read("explain/ExplainDesktopHint.tsx");
const composerSrc = read("explain/ExplainComposer.tsx");
const listSrc = read("explain/ExplainMessageList.tsx");
const captureBarSrc = read("explain/ExplainCaptureBar.tsx");
const jumpSrc = read("explain/useExplainJump.ts");
const headerSrc = read("explain/ExplainHeader.tsx");
const captureSrc = read("explain/useExplainCapture.ts");
const noteSrc = readFileSync(
  join(process.cwd(), "src/lib/ide/captureNote.ts"),
  "utf8"
);
const planSrc = readFileSync(
  join(process.cwd(), "src/lib/ide/capturePlan.ts"),
  "utf8"
);
const explorerSrc = read("IdeExplorer.tsx");

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
    expect(composerSrc).toContain("追问会带上当前对话");
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

describe("讲解面板：流式中可跳转、不无条件滚底", () => {
  it("列表跟滚走粘性 pin，不再 [messages, busy] 无条件 scrollTop", () => {
    expect(listSrc).toContain("shouldFollowExplainScroll");
    expect(listSrc).toContain("pointerdown");
    expect(listSrc).not.toMatch(
      /el\.scrollTop = el\.scrollHeight;\s*\}, \[messages, busy\]/
    );
  });

  it("busy 不锁 openFile / 引用跳转", () => {
    expect(jumpSrc).toContain("openFile");
    expect(jumpSrc).not.toMatch(/\bbusy\b/);
    expect(explorerSrc).not.toMatch(/\bbusy\b/);
    expect(listSrc).toContain("onCite");
    expect(sendSrc).toContain("getFlusher().schedule");
  });
});

describe("讲解面板：同工程多 thread", () => {
  it("Header 有历史、新对话，清空只针对当前对话", () => {
    expect(headerSrc).toContain('aria-label="历史"');
    expect(headerSrc).toContain('aria-label="新对话"');
    expect(headerSrc).toContain('aria-label="清空当前对话"');
    expect(headerSrc).toContain("startExplainThread");
    expect(headerSrc).toContain("switchExplainThread");
    expect(headerSrc).not.toMatch(/aria-label="清空"/);
  });

  it("发送 prior 仍来自当前 session 的活动 thread 消息", () => {
    expect(sendSrc).toContain("explainBySession[session.id]");
    expect(sendSrc.indexOf("selectExplainPriorMessages")).toBeLessThan(
      sendSrc.indexOf("pushExplainMessage")
    );
  });
});

describe("讲解面板：窄屏抽屉不整屏盖住编辑器", () => {
  const sheetSrc = read("explain/ExplainSheet.tsx");
  const heightSrc = read("../../lib/ide/explainSheet.ts");

  it("半高默认、加高档才铺遮罩，遮罩由档位决定", () => {
    expect(panelSrc).toContain("ExplainSheet");
    expect(sheetSrc).toContain("explainSheetHasScrim");
    expect(sheetSrc).toContain("explainSheetHeightStyle");
    expect(sheetSrc).toMatch(/explainSheetHasScrim\(state\)\s*&&/);
    expect(heightSrc).toContain("62");
    expect(heightSrc).toContain("92");
    // dvh + min() 走内联样式，别丢给 Tailwind JIT 扫描（未命中会退化成内容高度）。
    expect(heightSrc).toContain("dvh");
    expect(sheetSrc).toContain("style={explainSheetHeightStyle(state)}");
  });

  it("有抓手可在半高 / 加高之间切换", () => {
    expect(sheetSrc).toContain("toggleExplainSheet");
    expect(sheetSrc).toContain("explainSheetToggleLabel");
  });

  it("引用跳转成功后自动把加高档收到半高", () => {
    expect(panelSrc).toContain("nextExplainSheetAfterJump");
    expect(jumpSrc).toContain("onOpened");
  });

  it("窄屏不再写死 max-h-70dvh 的整块抽屉", () => {
    expect(panelSrc).not.toContain("max-h-[min(70dvh,100dvh)] flex flex-col min-h-0 animate-enter");
  });
});

describe("讲解面板：引用芯片点一下必有结果", () => {
  it("jumpCitation 走 runExplainCitationJump，成功文案是已打开 path:line", () => {
    expect(jumpSrc).toContain("runExplainCitationJump");
    expect(jumpSrc).toContain("formatExplainOpenedStatus");
    expect(jumpSrc).toContain("jumpCitation");
    expect(jumpSrc).toContain("openFile");
  });

  it("成功之后才清 failure：openFile 结果决定走 applyOpened 还是 applyMiss", () => {
    expect(jumpSrc).toMatch(/if\s*\(result\.ok\)\s*\{\s*applyOpened\(/);
    expect(jumpSrc).toContain("applyMiss(c.path, result.candidates, result.message)");
    // applyOpened 是唯一写成功文案的地方，且文案来自 formatExplainOpenedStatus。
    expect(jumpSrc).toMatch(
      /const applyOpened[\s\S]*?formatExplainOpenedStatus\(path, line, endLine\)/
    );
  });

  it("找不到时候选区仍可见，不只写 status", () => {
    expect(listSrc).toContain("jumpNotice");
    expect(listSrc).toContain("没有同名候选可点");
    expect(listSrc).toContain("failedCitePath");
  });

  it("失败芯片与正常芯片配色不同（--danger）", () => {
    const md = read("explain/markdown.tsx");
    expect(md).toContain("citeLooksFailed");
    expect(md).toContain("citeChipClass");
    expect(md).toContain("--danger");
  });

  it("无选区时当前选区写明先在编辑器划词且 disabled", () => {
    expect(composerSrc).toContain("先在编辑器划词");
    expect(composerSrc).toContain("disabled={!selectionActive}");
    expect(composerSrc).toContain("checked={includeSelection && selectionActive}");
    // 旁注与 title 同一句话，别只灰掉不解释。
    expect(composerSrc).toMatch(/title=\{!selectionActive \? "先在编辑器划词"/);
  });
});

describe("讲解面板：收入藏书阁路径可见", () => {
  it("空态与设置说明落盘目录，气泡旁能展示完整相对路径", () => {
    // 空态不再常驻长文，改由 ExplainUsageHelp 展开同一套落盘说明。
    expect(listSrc).toContain("ExplainUsageHelp");
    expect(listSrc).not.toContain("IDE_NOTE_DESTINATION_HINT");
    expect(hintSrc).toContain("IDE_NOTE_DESTINATION_HINT");
    expect(captureBarSrc).toContain("savedPath");
    expect(captureBarSrc).toContain("在藏书阁打开");
    expect(panel).toContain("savedNotes=");
  });
});

describe("讲解面板：使用说明可折叠", () => {
  const helpSrc = read("explain/ExplainUsageHelp.tsx");
  it("空态用「使用说明」按钮，默认不铺开长文", () => {
    expect(listSrc).toContain("ExplainUsageHelp");
    expect(listSrc).not.toContain("提问会带上当前文件");
    expect(helpSrc).toContain("使用说明");
    expect(helpSrc).toContain("IDE_EXPLAIN_USAGE_INTRO");
    expect(helpSrc).toContain("IDE_NOTE_DESTINATION_HINT");
    expect(helpSrc).toContain('aria-expanded');
    expect(helpSrc).toContain("Escape");
    expect(helpSrc).toContain("pointerdown");
  });
});

describe("讲解面板：收入本段对话", () => {
  it("Header 有「收入本段」，落点与「在藏书阁打开」都在头部可见", () => {
    expect(headerSrc).toContain("onCaptureThread");
    expect(headerSrc).toContain("收入本段");
    expect(headerSrc).toContain("savedThreadPath");
    expect(headerSrc).toContain("在藏书阁打开");
  });

  it("整段收入走 captureExplainThreadToLibrary，单条路径仍在", () => {
    expect(captureSrc).toContain("captureExplainThreadToLibrary");
    expect(captureSrc).toContain("captureExplainToLibrary(");
    expect(captureSrc).toContain("captureSnippetToLibrary(");
    expect(panel).toContain("capture.captureThread");
    expect(panel).toContain("capture.savedThread");
  });

  it("落点用 讲解-<短标题>，与单条 YYYY-MM-DD-<文件>.md 不碰撞", () => {
    expect(noteSrc).toContain("explainThreadNotePath");
    expect(noteSrc).toContain("-讲解-");
    // 整段对话不写 files 里的源码正文。
    expect(noteSrc).toContain("turns");
    expect(planSrc).toContain("captureExplainThread");
  });
});

describe("讲解面板：生成中不再空转", () => {
  const timeoutSrc = readFileSync(
    join(process.cwd(), "src/lib/ide/explainTimeout.ts"),
    "utf8"
  );
  const clientSrc = readFileSync(
    join(process.cwd(), "src/lib/ide/explainClient.ts"),
    "utf8"
  );
  const routeSrc = readFileSync(
    join(process.cwd(), "src/app/api/ide/explain/route.ts"),
    "utf8"
  );

  it("气泡只在 busy 且末条空助手时转圈，否则未生成内容可重试", () => {
    expect(listSrc).toContain("assistantBubbleKind");
    expect(listSrc).toContain("未生成内容");
    expect(listSrc).toContain("重试");
    expect(listSrc).not.toMatch(/msg\.content \? \(/);
  });

  it("onDone 空 acc 写成未生成内容，不留空串", () => {
    expect(sendSrc).toContain("finalizeExplainReply");
    expect(timeoutSrc).toContain("EMPTY_EXPLAIN_REPLY");
    expect(timeoutSrc).toContain("（未生成内容）");
  });

  it("勾了带上当前文件但没打开文件时状态栏提示，不阻断", () => {
    expect(sendSrc).toContain("未打开文件，本轮不带正文");
    expect(sendSrc).toMatch(/if \(useFile && !activeTab && !includeFolder\)/);
  });

  it("可带上工程内限额文件正文，没有打开文件也能发", () => {
    expect(sendSrc).toContain("planExplainFolderFiles");
    expect(sendSrc).toContain("IDE_EXPLAIN_FOLDER_MAX_FILES_ANDROID");
    expect(sendSrc).toContain("isTauriAndroidRuntime");
    expect(sendSrc).toContain(
      "const [includeFolder, setIncludeFolder] = React.useState(false)"
    );
    expect(sendSrc).toContain("本轮带上工程内");
    expect(composerSrc).toContain("带上工程文件");
    expect(composerSrc).toContain("这个工程在干什么");
    expect(panelSrc).toContain("includeFolder={stream.includeFolder}");
  });

  it("桌面与浏览器通路都有整轮超时，文案不含 Key", () => {
    expect(clientSrc).toContain("raceWithDeadline");
    expect(clientSrc).toContain("EXPLAIN_REQUEST_TIMEOUT_MS");
    expect(clientSrc).toContain("explainTimeoutMessage");
    expect(routeSrc).toContain("AbortSignal.timeout");
    expect(timeoutSrc).toContain("检查网络或 Base URL");
    expect(timeoutSrc).not.toMatch(/sk-/);
  });
});

describe("讲解面板：桌面通路", () => {
  it("发送前快照 prior，清空后的历史不会进下一请求", () => {
    expect(sendSrc).toContain("selectExplainPriorMessages");
    expect(sendSrc).toContain("prior");
    const snapAt = sendSrc.indexOf("selectExplainPriorMessages");
    const pushAt = sendSrc.indexOf("pushExplainMessage");
    expect(snapAt).toBeGreaterThan(0);
    expect(snapAt).toBeLessThan(pushAt);
  });

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
