/**
 * 讲解传输超时与空气泡判定。
 *
 * 不改 prompt：只约束「连上之后不吐数据」不能把 invoke / fetch 挂到永远，
 * 以及空助手气泡不能只凭 content==='' 就永远显示「生成中…」。
 */

/** 连上 TCP 之后整轮上限（含等首包）。与 Rust `REQUEST_TIMEOUT_SECS` 对齐。 */
export const EXPLAIN_REQUEST_TIMEOUT_MS = 75_000;

/** 读空闲：两次 chunk 之间太久就当挂死。与 Rust `READ_IDLE_TIMEOUT_SECS` 对齐。 */
export const EXPLAIN_READ_IDLE_TIMEOUT_MS = 45_000;

/** 空响应写进气泡，避免 persist 一条空 assistant 被当成还在生成。 */
export const EMPTY_EXPLAIN_REPLY = "（未生成内容）";

/** 与 Rust `connect_error` 超时分支同一句式；base 可空；绝不拼 Key。 */
export function explainTimeoutMessage(base?: string): string {
  const b = (base || "").trim().replace(/\/$/, "");
  if (b) return `连接 ${b} 超时，检查网络或 Base URL`;
  return "连接超时，检查网络或 Base URL";
}

export function finalizeExplainReply(acc: string): string {
  return acc.trim() ? acc : EMPTY_EXPLAIN_REPLY;
}

export type AssistantBubbleKind = "generating" | "empty" | "body";

/**
 * 空气泡什么时候转圈。
 *
 * 只允许「正在 busy，且这一条是末条空助手」。重开面板后 busy 是本地的，
 * persist 下来的空 assistant 必须走 empty，不能假忙。
 */
export function assistantBubbleKind(opts: {
  content: string;
  busy: boolean;
  isLast: boolean;
}): AssistantBubbleKind {
  if (opts.content.trim()) return "body";
  if (opts.busy && opts.isLast) return "generating";
  return "empty";
}

export function isAbortLike(err: unknown): boolean {
  if (!err) return false;
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError" || /aborted|abort|timeout/i.test(err.message);
  }
  return false;
}

/** 用户点停止以外的传输失败：超时走中文，其它原样（已经是中文的上游错误）。 */
export function explainTransportFailure(
  err: unknown,
  opts: { userAborted: boolean; baseUrl?: string }
): { kind: "aborted" } | { kind: "error"; message: string } {
  if (opts.userAborted) return { kind: "aborted" };
  if (isAbortLike(err)) {
    return { kind: "error", message: explainTimeoutMessage(opts.baseUrl) };
  }
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const msg = raw.trim() || "讲解失败";
  return { kind: "error", message: msg };
}

/**
 * 把用户 AbortSignal 和整轮超时合成一个。不依赖 AbortSignal.any（安卓 WebView 版本参差）。
 * 超时 abort 时用户 signal 仍是未中止，调用方可据此区分「点了停止」和「挂死」。
 */
export function mergeExplainAbort(
  user: AbortSignal,
  ms: number = EXPLAIN_REQUEST_TIMEOUT_MS
): { signal: AbortSignal; dispose: () => void } {
  const ac = new AbortController();
  const onUser = () => ac.abort(user.reason);
  if (user.aborted) {
    ac.abort(user.reason);
    return { signal: ac.signal, dispose: () => {} };
  }
  user.addEventListener("abort", onUser, { once: true });
  const timer = setTimeout(() => {
    if (!user.aborted && !ac.signal.aborted) ac.abort("explain-timeout");
  }, ms);
  return {
    signal: ac.signal,
    dispose: () => {
      clearTimeout(timer);
      user.removeEventListener("abort", onUser);
    },
  };
}

/** Promise.race 带清理，避免超时 Promise 一直 pending。用户停止立刻结束，不等整轮上限。 */
export function raceWithDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => Error,
  user?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (user?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => reject(onTimeout()), ms);
    const onUser = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    user?.addEventListener("abort", onUser, { once: true });
    const done = () => {
      clearTimeout(timer);
      user?.removeEventListener("abort", onUser);
    };
    work.then(
      (v) => {
        done();
        resolve(v);
      },
      (e) => {
        done();
        reject(e);
      }
    );
  });
}
