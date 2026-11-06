"use client";

/**
 * 桌面讲解的唯一通路（打包版没有 Next Route Handler）。
 *
 * 分三层，刻意让两边共用同一份语义：
 * 1. prompt 组装、mock 文本 → `src/lib/ide/explain.ts`（单一来源，浏览器也用它）
 * 2. HTTP 传输 → Rust `ide_explain`（`src-tauri/src/explain.rs`），逐块推流
 * 3. 这里只做「选哪条路」和错误归类，不复制任何提示词
 *
 * 隐私边界：Key 从 IDE 自己的 IndexedDB 读出来，随请求走一次 IPC，
 * 不落盘、不写日志、不读环境变量；除了用户填的 Base URL，不联系任何地址。
 */

import { isTauriRuntime } from "@/lib/storage/contentApi";
import {
  assembleExplainChatMessages,
  assembleExplainUserContent,
  buildMockExplainMarkdown,
  IDE_EXPLAIN_SYSTEM_PROMPT,
  type ExplainChatMessage,
  type IdeExplainFilePayload,
} from "@/lib/ide/explain";
import {
  EXPLAIN_REQUEST_TIMEOUT_MS,
  explainTimeoutMessage,
  explainTransportFailure,
  mergeExplainAbort,
  raceWithDeadline,
} from "@/lib/ide/explainTimeout";

export type ExplainStreamHandlers = {
  onDelta: (text: string) => void;
  onDone: (info: { mock: boolean }) => void;
};

export type ExplainStreamRequest = {
  question: string;
  files: IdeExplainFilePayload[];
  fileIndex?: string[];
  /** 本轮之前的对话文本（不含 files 正文）。 */
  prior?: ExplainChatMessage[];
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Cancellation handle shared with the caller's AbortController. */
  signal: AbortSignal;
};

/** Readable fallback when a bridge error is not already a sentence. */
export const DESKTOP_EXPLAIN_BRIDGE_ERROR =
  "桌面讲解通道不可用（应用版本过旧？），请更新安装包或改用浏览器。";

/** Chunks are plain strings; a `{type:"done"}` marker ends the turn. */
type DesktopEvent = { type: "delta"; text: string } | { type: "done" };

function requestId(): string {
  return `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function chatMessagesFor(req: ExplainStreamRequest): ExplainChatMessage[] {
  return assembleExplainChatMessages({
    question: req.question,
    files: req.files,
    fileIndex: req.fileIndex,
    prior: req.prior,
  });
}

function normalizeBridgeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const msg = raw.trim();
  if (!msg) return DESKTOP_EXPLAIN_BRIDGE_ERROR;
  // Unknown-command means the packaged binary predates this bridge.
  if (/ide_explain/.test(msg) && /not found|unknown|未找到/i.test(msg)) {
    return DESKTOP_EXPLAIN_BRIDGE_ERROR;
  }
  return msg;
}

/**
 * Stream one explain turn. Desktop uses the Rust bridge; the browser keeps
 * using the Next route so `npm run dev` behaviour is untouched.
 */
export async function streamExplain(
  req: ExplainStreamRequest,
  handlers: ExplainStreamHandlers
): Promise<void> {
  if (isTauriRuntime()) {
    return streamViaTauri(req, handlers);
  }
  return streamViaNextRoute(req, handlers);
}

async function streamViaTauri(
  req: ExplainStreamRequest,
  handlers: ExplainStreamHandlers
): Promise<void> {
  const key = req.apiKey.trim();
  if (!key) {
    // Same contract as the Next route: no key → deterministic local sample.
    const text = buildMockExplainMarkdown({
      question: req.question,
      files: req.files,
      fileIndex: req.fileIndex,
      prior: req.prior,
    });
    handlers.onDelta(text);
    handlers.onDone({ mock: true });
    return;
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const id = requestId();
  let finished = false;
  const onAbort = () => {
    // Best effort: the Rust loop checks this on its next chunk.
    void invoke("ide_explain_cancel", { requestId: id }).catch(() => {});
  };
  req.signal.addEventListener("abort", onAbort, { once: true });

  const channel = new Channel<DesktopEvent>();
  channel.onmessage = (ev) => {
    if (finished) return;
    if (ev.type === "delta") {
      handlers.onDelta(ev.text);
      return;
    }
    if (ev.type === "done") {
      finished = true;
      handlers.onDone({ mock: false });
    }
  };

  try {
    const messages = chatMessagesFor(req);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    await raceWithDeadline(
      invoke("ide_explain", {
        args: {
          requestId: id,
          systemPrompt: IDE_EXPLAIN_SYSTEM_PROMPT,
          userContent: lastUser?.content
            || assembleExplainUserContent(req.question, req.files, req.fileIndex),
          messages,
          apiKey: key,
          baseUrl: req.baseUrl.trim(),
          model: req.model.trim(),
        },
        onEvent: channel,
      }),
      EXPLAIN_REQUEST_TIMEOUT_MS,
      () => {
        void invoke("ide_explain_cancel", { requestId: id }).catch(() => {});
        return new Error(explainTimeoutMessage(req.baseUrl));
      },
      req.signal
    );
    // A cancelled turn returns Ok without a done event; the caller already
    // knows it aborted, so don't fake completion.
    if (!finished && !req.signal.aborted) {
      finished = true;
      handlers.onDone({ mock: false });
    }
  } catch (e) {
    if (req.signal.aborted) return;
    throw new Error(normalizeBridgeError(e));
  } finally {
    finished = true;
    req.signal.removeEventListener("abort", onAbort);
  }
}

async function streamViaNextRoute(
  req: ExplainStreamRequest,
  handlers: ExplainStreamHandlers
): Promise<void> {
  const body: Record<string, unknown> = {
    question: req.question,
    files: req.files,
    fileIndex: req.fileIndex,
    messages: chatMessagesFor(req),
    locale: "zh",
  };
  if (req.apiKey.trim()) body.apiKey = req.apiKey.trim();
  if (req.baseUrl.trim()) body.baseUrl = req.baseUrl.trim();
  if (req.model.trim()) body.model = req.model.trim();

  const merged = mergeExplainAbort(req.signal, EXPLAIN_REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch("/api/ide/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: merged.signal,
      });
    } catch (e) {
      if (req.signal.aborted) throw e;
      const fail = explainTransportFailure(e, {
        userAborted: false,
        baseUrl: req.baseUrl,
      });
      throw new Error(fail.kind === "error" ? fail.message : explainTimeoutMessage(req.baseUrl));
    }

    if (!res.ok) {
      let err = `讲解失败（${res.status}）`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) err = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(err);
    }

    const mock = res.headers.get("X-Langhuan-Explain") === "mock";
    const reader = res.body?.getReader();
    if (!reader) throw new Error("无响应流");

    const decoder = new TextDecoder();
    let seen = "";
    let lastSent = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      // Same contract as the desktop bridge: hand over only the new text.
      if (seen.startsWith(lastSent)) {
        const fresh = seen.slice(lastSent.length);
        if (fresh) {
          lastSent = seen;
          handlers.onDelta(fresh);
        }
      } else {
        lastSent = seen;
        handlers.onDelta(seen);
      }
    }
    handlers.onDone({ mock });
  } finally {
    merged.dispose();
  }
}
