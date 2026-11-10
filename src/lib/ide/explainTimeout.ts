/**
 * 讲解传输超时与空气泡判定。
 *
 * 不改 prompt：只约束「连上之后不吐数据」不能把 invoke / fetch 挂到永远，
 * 以及空助手气泡不能只凭 content==='' 就永远显示「生成中…」。
 */

/** 等到首个 token 的上限。与 Rust `FIRST_BYTE_TIMEOUT_SECS` 对齐。 */
export const EXPLAIN_FIRST_BYTE_TIMEOUT_MS = 120_000;

/** 整轮上限（含生成）。首包之后不再用这个去杀流。与 Rust 文档窗口对齐。 */
export const EXPLAIN_REQUEST_TIMEOUT_MS = 300_000;

/** 读空闲：两次 chunk 之间太久就当挂死。与 Rust `READ_IDLE_TIMEOUT_SECS` 对齐。 */
export const EXPLAIN_READ_IDLE_TIMEOUT_MS = 90_000;

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

export const EXPLAIN_OFFLINE_MESSAGE =
  "当前无网络，讲解需要联网。阅读、批注、笔记、专题和已导入的读码项目仍可离线使用。";

export const EXPLAIN_NETWORK_FAILURE_MESSAGE =
  "讲解请求失败（网络或接口不可用）。阅读、批注、笔记、专题和已导入的读码项目不受影响，可继续使用。";

export function isNavigatorOffline(online: boolean | undefined = undefined): boolean {
  if (typeof online === "boolean") return !online;
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

export function isExplainNetworkFailure(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "");
  const name = err instanceof Error ? err.name : "";
  return /failed to fetch|networkerror|network request failed|load failed|net::err_|err_internet|offline|internet disconnected/i.test(
    `${name} ${raw}`
  );
}

/** 用户点停止以外的传输失败：超时走中文，离线/网络失败说明不影响本地学习，其它原样。 */
export function explainTransportFailure(
  err: unknown,
  opts: { userAborted: boolean; baseUrl?: string; online?: boolean }
): { kind: "aborted" } | { kind: "error"; message: string } {
  if (opts.userAborted) return { kind: "aborted" };
  if (isAbortLike(err)) {
    return { kind: "error", message: explainTimeoutMessage(opts.baseUrl) };
  }
  if (isNavigatorOffline(opts.online) || isExplainNetworkFailure(err)) {
    return {
      kind: "error",
      message: isNavigatorOffline(opts.online)
        ? EXPLAIN_OFFLINE_MESSAGE
        : EXPLAIN_NETWORK_FAILURE_MESSAGE,
    };
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

/**
 * 首包 / 读空闲 / 整轮 三档，不依赖 AbortSignal.any。
 * 收到字节后取消「等首包」，并重置空闲时钟；用户停止不算超时。
 */
export function createExplainWatchdog(
  user: AbortSignal,
  opts?: {
    firstByteMs?: number;
    idleMs?: number;
    overallMs?: number;
  }
): { signal: AbortSignal; noteByte: () => void; dispose: () => void } {
  const firstByteMs = opts?.firstByteMs ?? EXPLAIN_FIRST_BYTE_TIMEOUT_MS;
  const idleMs = opts?.idleMs ?? EXPLAIN_READ_IDLE_TIMEOUT_MS;
  const overallMs = opts?.overallMs ?? EXPLAIN_REQUEST_TIMEOUT_MS;
  const ac = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const abortTimeout = () => {
    if (!user.aborted && !ac.signal.aborted) ac.abort("explain-timeout");
  };
  const onUser = () => ac.abort(user.reason);
  if (user.aborted) {
    ac.abort(user.reason);
    return { signal: ac.signal, noteByte: () => {}, dispose: () => {} };
  }
  user.addEventListener("abort", onUser, { once: true });
  const first = setTimeout(abortTimeout, firstByteMs);
  const overall = setTimeout(abortTimeout, overallMs);
  let firstCleared = false;
  return {
    signal: ac.signal,
    noteByte: () => {
      if (!firstCleared) {
        firstCleared = true;
        clearTimeout(first);
      }
      if (idle) clearTimeout(idle);
      idle = setTimeout(abortTimeout, idleMs);
    },
    dispose: () => {
      clearTimeout(first);
      clearTimeout(overall);
      if (idle) clearTimeout(idle);
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
