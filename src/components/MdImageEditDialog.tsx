"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  findMarkdownImageByHref,
  rewriteMarkdownImage,
  type MdImageWidth,
} from "@/lib/assets/mdImageEdit";
import { useStore } from "@/lib/store";

const WIDTH_PRESETS: { label: string; value: MdImageWidth }[] = [
  { label: "自动", value: "auto" },
  { label: "50%", value: "50%" },
  { label: "75%", value: "75%" },
  { label: "100%", value: "100%" },
  { label: "400px", value: "400px" },
];

export function MdImageEditDialog({
  open,
  onClose,
  docId,
  hrefHint,
  initialAlt,
  initialWidth,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  /** Original markdown href or vault path basename hint. */
  hrefHint: string;
  initialAlt: string;
  initialWidth: MdImageWidth;
}) {
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const setStatus = useStore((s) => s.setStatus);
  const [alt, setAlt] = React.useState(initialAlt);
  const [width, setWidth] = React.useState<MdImageWidth>(initialWidth);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAlt(initialAlt);
    setWidth(initialWidth);
    setError(null);
  }, [open, initialAlt, initialWidth]);

  const onSave = () => {
    const source = getContent(docId);
    const match = findMarkdownImageByHref(source, hrefHint);
    if (!match) {
      setError("正文里找不到这张图的 Markdown 标记，请改用源码编辑。");
      setStatus("找不到对应的图片标记");
      return;
    }
    const next = rewriteMarkdownImage(source, match, {
      alt: alt.trim(),
      width,
    });
    setDraft(docId, next);
    setStatus("已更新图片说明/宽度");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="md-img-edit-title" className="max-w-md">
      <div className="p-5 space-y-3">
        <h2 id="md-img-edit-title" className="font-serif text-lg font-semibold">
          编辑图片
        </h2>
        <p className="text-xs text-[var(--muted)] break-all">路径：{hrefHint}</p>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">说明（alt / 图注）</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-sm"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="简短说明"
          />
        </label>
        <div>
          <div className="text-sm text-[var(--muted)] mb-1">显示宽度</div>
          <div className="flex flex-wrap gap-1.5">
            {WIDTH_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={
                  "rounded-lg border px-2.5 py-1 text-xs " +
                  (width === p.value
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]")
                }
                onClick={() => setWidth(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-[var(--accent)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
