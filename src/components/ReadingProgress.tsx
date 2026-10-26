"use client";

import * as React from "react";

export function ReadingProgress() {
  const [p, setP] = React.useState(0);
  React.useEffect(() => {
    const el = document.getElementById("reader-scroll");
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setP(max > 0 ? (el.scrollTop / max) * 100 : 0);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="absolute top-0 left-0 right-0 h-[2px] z-40 pointer-events-none">
      <div className="h-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${p}%` }} />
    </div>
  );
}
