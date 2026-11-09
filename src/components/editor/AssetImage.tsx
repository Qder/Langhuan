"use client";

import * as React from "react";
import { getAssetObjectUrl } from "@/lib/assets/store";
import { isTauriRuntime, libraryFileUrl, resolveLibraryFileUrl } from "@/lib/storage/contentApi";

/** Resolve attachment: prefer content/ (API or Tauri), fall back to IDB blob URL. */
export function AssetImage({
  assetId,
  path,
  alt,
  title,
  className,
  style,
}: {
  assetId: string;
  /** Vault-relative path — when set, loads from content library. */
  path?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [src, setSrc] = React.useState<string | null>(() =>
    path && !isTauriRuntime() ? libraryFileUrl(path) : null
  );
  React.useEffect(() => {
    let alive = true;
    if (path) {
      void resolveLibraryFileUrl(path)
        .then((u) => {
          if (alive) setSrc(u);
        })
        .catch(() => {
          void getAssetObjectUrl(assetId).then((u) => {
            if (alive && u) setSrc(u);
          });
        });
      return () => {
        alive = false;
      };
    }
    void getAssetObjectUrl(assetId).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [assetId, path]);
  if (!src) {
    return (
      <span className="lh-broken-img" role="img" aria-label={alt || "加载中"}>
        <span className="lh-broken-img-label">图片加载中…</span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || ""}
      title={title}
      style={style}
      className={className}
      onError={() => {
        if (path) {
          void getAssetObjectUrl(assetId).then((u) => {
            if (u) setSrc(u);
          });
        }
      }}
    />
  );
}
