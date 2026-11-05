"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import type { SendExplain } from "./types";

/**
 * Consume the one-shot「讲解选区」request.
 *
 * Include flags are aligned during render (props → state). Sending stays in
 * an effect so we don't trip set-state-in-effect, and a nonce ref stops the
 * store-clear from firing the same question twice.
 */
export function usePendingExplain({
  sendRef,
  setIncludeFile,
  setIncludeSelection,
}: {
  sendRef: React.MutableRefObject<SendExplain>;
  setIncludeFile: (v: boolean) => void;
  setIncludeSelection: (v: boolean) => void;
}) {
  const pendingExplainRequest = useIdeStore((s) => s.pendingExplainRequest);
  const clearPendingExplainRequest = useIdeStore(
    (s) => s.clearPendingExplainRequest
  );
  const handledRequestNonceRef = React.useRef<number | null>(null);
  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [appliedRequestNonce, setAppliedRequestNonce] = React.useState<
    number | null
  >(null);
  if (
    pendingExplainRequest &&
    pendingExplainRequest.nonce !== appliedRequestNonce
  ) {
    setAppliedRequestNonce(pendingExplainRequest.nonce);
    setIncludeFile(pendingExplainRequest.includeFile);
    setIncludeSelection(pendingExplainRequest.includeSelection);
  }

  React.useEffect(() => {
    const req = pendingExplainRequest;
    if (!req || handledRequestNonceRef.current === req.nonce) return;
    // 先记下 nonce：clearPendingExplainRequest() 会让这个 effect 再跑一次（req
    // 变 null），没有这层记录就会重复发送。
    handledRequestNonceRef.current = req.nonce;
    clearPendingExplainRequest();
    // 不能在这里返回 cleanup：store 更新会立刻重跑 effect 并清掉 timeout，
    // 那次自动发送就没了。卸载保护改用 aliveRef 在回调里判断。
    window.setTimeout(() => {
      if (!aliveRef.current) return;
      void sendRef.current(req.question, {
        includeFile: req.includeFile,
        includeSelection: req.includeSelection,
      });
    }, 0);
  }, [pendingExplainRequest, clearPendingExplainRequest, sendRef]);
}
