"use client";

import * as React from "react";
import { getAssetObjectUrl } from "@/lib/assets/store";

/** Resolve an IndexedDB asset id to an object URL for <img>. */
export function AssetImage({
  assetId,
  alt,
  title,
  className,
}: {
  assetId: string;
  alt?: string;
  title?: string;
  className?: string;
}) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    void getAssetObjectUrl(assetId).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);
  if (!src) {
    return (
      <span className="lh-broken-img" role="img" aria-label={alt || "加载中"}>
        <span className="lh-broken-img-label">图片加载中…</span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt || ""} title={title} className={className} />
  );
}
