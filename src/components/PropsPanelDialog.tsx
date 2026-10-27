"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { DOC_STATUS_LABEL, getDocMeta, type DocStatus } from "@/lib/docMeta";

export function PropsPanelDialog() {
  const open = useStore((s) => s.propsDialogOpen);
  const setOpen = useStore((s) => s.setPropsDialogOpen);
  const activeId = useStore((s) => s.activeId);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const setDocMeta = useStore((s) => s.setDocMeta);
  const saveDoc = useStore((s) => s.saveDoc);
  const doc = documents.find((d) => d.id === activeId) || null;

  const [title, setTitle] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [aliases, setAliases] = React.useState("");
  const [status, setStatus] = React.useState<DocStatus>("");
  const [source, setSource] = React.useState("");

  React.useEffect(() => {
    if (!open || !doc) return;
    const live = { ...doc, content: getContent(doc.id) };
    const m = getDocMeta(live);
    setTitle(m.title);
    setTags(m.tags.join(", "));
    setAliases(m.aliases.join(", "));
    setStatus(m.status);
    setSource(m.source || "");
  }, [open, doc, getContent]);

  if (!doc) {
    return (
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="props-title">
        <div className="p-5">
          <h2 id="props-title" className="font-serif text-lg font-semibold">
            属性
          </h2>
          <p className="text-sm text-[var(--muted)] mt-2">请先打开一篇文档。</p>
        </div>
      </Dialog>
    );
  }

  const apply = () => {
    setDocMeta(doc.id, {
      title: title.trim(),
      tags: tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      aliases: aliases
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      status,
      source: source.trim() || undefined,
    });
    saveDoc(doc.id);
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="props-title">
      <div className="p-5 space-y-3">
        <h2 id="props-title" className="font-serif text-lg font-semibold">
          属性面板
        </h2>
        <p className="text-xs text-[var(--muted)]">用表单编辑 frontmatter / meta，无需手写 YAML。</p>
        <label className="block text-xs text-[var(--muted)]">
          标题
          <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--muted)]">
          标签（逗号分隔）
          <Input className="mt-1" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--muted)]">
          别名（用于双链解析）
          <Input className="mt-1" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--muted)]">
          状态
          <select
            className="mt-1 w-full h-9 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as DocStatus)}
          >
            <option value="">（无）</option>
            <option value="draft">{DOC_STATUS_LABEL.draft}</option>
            <option value="evergreen">{DOC_STATUS_LABEL.evergreen}</option>
            <option value="archived">{DOC_STATUS_LABEL.archived}</option>
          </select>
        </label>
        <label className="block text-xs text-[var(--muted)]">
          来源 URL
          <Input className="mt-1" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="accent" onClick={apply}>
            保存属性
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
