"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import {
  listFolderPaths,
  parseDocPathInput,
  type DocTypeExt,
} from "@/lib/folders";
import {
  subscribeCreateDocDialog,
  type CreateDocDialogRequest,
} from "@/lib/createDocDialogBus";

export type CreateDocDialogProps = {
  open: boolean;
  onClose: () => void;
  type: DocTypeExt;
  /** Default parent folder ("" = library root). */
  defaultParent: string;
  /** Prefill path/name input. */
  defaultName?: string;
};

export function CreateDocDialog({
  open,
  onClose,
  type,
  defaultParent,
  defaultName = "",
}: CreateDocDialogProps) {
  const documents = useStore((s) => s.documents);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const createDoc = useStore((s) => s.createDoc);
  const requestTreeReveal = useStore((s) => s.requestTreeReveal);

  const [parent, setParent] = React.useState(defaultParent);
  const [pathInput, setPathInput] = React.useState("");
  const [docType, setDocType] = React.useState<DocTypeExt>(type);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setParent(defaultParent);
    setPathInput(defaultName);
    setDocType(type);
    setError(null);
  }, [open, defaultParent, defaultName, type]);

  const folderOptions = React.useMemo(
    () => listFolderPaths(documents, emptyFolders),
    [documents, emptyFolders]
  );

  const preview = React.useMemo(() => {
    const parsed = parseDocPathInput(pathInput, parent, docType);
    if (!parsed.ok) return null;
    return parsed.fullPath;
  }, [pathInput, parent, docType]);

  const submit = React.useCallback(() => {
    const parsed = parseDocPathInput(pathInput, parent, docType);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    const doc = createDoc({ type: docType, path: parsed.fullPath, open: true });
    requestTreeReveal(doc.id);
    onClose();
  }, [pathInput, parent, docType, createDoc, requestTreeReveal, onClose]);

  const title = docType === "md" ? "新建 Markdown 笔记" : "新建 HTML 页面";
  const placeholder =
    docType === "md" ? "算法/图论/最短路 或 未命名笔记" : "收藏/页面名 或 未命名页面";

  return (
    <Dialog open={open} onClose={onClose} labelledBy="create-doc-title">
      <div className="p-5 space-y-3">
        <h2 id="create-doc-title" className="font-serif text-lg font-semibold">
          {title}
        </h2>

        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">位置</span>
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-ui text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
          >
            <option value="">库根目录</option>
            {folderOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-[var(--muted)]">类型</legend>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={docType === "md" ? "accent" : "outline"}
              className="flex-1"
              onClick={() => {
                setDocType("md");
                setError(null);
              }}
            >
              Markdown
            </Button>
            <Button
              type="button"
              variant={docType === "html" ? "accent" : "outline"}
              className="flex-1"
              onClick={() => {
                setDocType("html");
                setError(null);
              }}
            >
              HTML
            </Button>
          </div>
        </fieldset>

        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">路径 / 文件名</span>
          <Input
            autoFocus
            value={pathInput}
            onChange={(e) => {
              setPathInput(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-xs font-mono text-[var(--muted)] break-all">
          {preview ? (
            <>
              将创建：<span className="text-[var(--fg)]">{preview}</span>
            </>
          ) : (
            "输入路径后显示完整库内路径；留空则使用默认文件名"
          )}
        </div>

        {error ? (
          <p className="text-xs text-[var(--accent)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={submit}>
            创建
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Mount once (e.g. AppShell); opens via openCreateDocDialog(). */
export function CreateDocDialogHost() {
  const [req, setReq] = React.useState<CreateDocDialogRequest | null>(null);

  React.useEffect(() => subscribeCreateDocDialog(setReq), []);

  if (!req) return null;
  return (
    <CreateDocDialog
      key={`${req.type}::${req.defaultParent}::${req.defaultName ?? ""}::open`}
      open
      type={req.type}
      defaultParent={req.defaultParent}
      defaultName={req.defaultName}
      onClose={() => setReq(null)}
    />
  );
}
