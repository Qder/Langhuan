"use client";

import * as React from "react";
import { keyboardInsetPx } from "./keyboardInset";

/**
 * 当前软键盘（或同等大的底部遮挡）像素。桌面和无 visualViewport 时恒为 0。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);

  React.useEffect(() => {
    const read = () => {
      const vp = window.visualViewport;
      const next = keyboardInsetPx(
        vp ? { height: vp.height, offsetTop: vp.offsetTop } : null,
        window.innerHeight
      );
      setInset((cur) => (cur === next ? cur : next));
    };
    read();
    const vp = window.visualViewport;
    if (!vp) return;
    vp.addEventListener("resize", read);
    vp.addEventListener("scroll", read);
    window.addEventListener("resize", read);
    return () => {
      vp.removeEventListener("resize", read);
      vp.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  return inset;
}
