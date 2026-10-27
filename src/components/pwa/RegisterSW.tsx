"use client";

import * as React from "react";

/** Register the offline shell service worker once on the client. */
export function RegisterSW() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only on https or localhost
    const ok =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!ok) return;
    const ready = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignore */
      });
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready);
    return () => window.removeEventListener("load", ready);
  }, []);
  return null;
}
