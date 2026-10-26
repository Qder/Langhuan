"use client";

import * as React from "react";
import { FileCode2, FilePlus2, FolderInput, Globe, Search, Star } from "lucide-react";
import { useStore } from "@/lib/store";
import { collectTagCounts, getTags } from "@/lib/tags";
import { countAllBacklinks } from "@/lib/search";
import {
  countWords,
  greetingByHour,
  mdExcerpt,
  relativeTime,
  stripHtml,
  titleOf,
  cn,
} from "@/lib/utils";
import { ImportFolderDialog } from "./ImportFolderDialog";

export function HomeView() {
  const documents = useStore((s) => s.documents);
  const createDoc = useStore((s) => s.createDoc);
  const openDoc = useStore((s) => s.openDoc);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const resetSeed = useStore((s) => s.resetSeed);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = React.useState<{ path: string; content: string }[] | null>(null);

  const tags = collectTagCounts(documents);
  const words = documents.reduce((n, d) => n + countWords(d.type === "html" ? stripHtml(d.content) : d.content), 0);
  const backlinks = countAllBacklinks(documents);
  const recent = [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const starred = documents.filter((d) => d.starred);

  const onPaste = () => {
    const text = window.prompt("粘贴 Markdown 或 HTML 源码：");
    if (text == null || !text.trim()) return;
    const isHtml = /^\s*</.test(text) || /<\/?[a-z][\s\S]*>/i.test(text);
    createDoc({ type: isHtml ? "html" : "md", content: text });
  };

  const shortcuts = [
    { title: "新建笔记", desc: "写一篇 Markdown", icon: FilePlus2, onClick: () => createDoc({ type: "md" }) },
    { title: "新建页面", desc: "收藏 HTML", icon: Globe, onClick: () => createDoc({ type: "html" }) },
    { title: "粘贴源码", desc: "快速收入片段", icon: FileCode2, onClick: onPaste },
    { title: "导入文件夹", desc: "保留目录结构", icon: FolderInput, onClick: () => folderRef.current?.click() },
  ];

  return (
    <div id="reader-scroll" className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-12 animate-enter space-y-10">
        <section className="relative overflow-hidden rounded-2xl card-surface p-6 md:p-10">
          <div className="pointer-events-none absolute -right-4 -top-8 font-serif text-[180px] leading-none text-[var(--fg)] opacity-[0.04] select-none">
            嬛
          </div>
          <div className="relative z-10 space-y-4 max-w-2xl">
            <div className="text-sm text-[var(--muted)] font-ui">{greetingByHour()}，欢迎回阁</div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight">琅嬛·藏书阁</h1>
            <p className="text-[var(--muted)] leading-relaxed">
              把笔记与页面收进同一座阁。本地保存，纸墨朱砂，安静好用。
            </p>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="flex h-12 w-full max-w-xl items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-4 text-left hover:bg-[var(--hover)] transition-colors"
            >
              <Search className="h-4 w-4 text-[var(--muted)]" />
              <span className="flex-1 text-[var(--muted)] text-sm">搜索文档、标签或命令…</span>
              <kbd className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted)]">⌘K</kbd>
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {shortcuts.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={s.onClick}
              className="card-surface hover-lift p-4 text-left"
            >
              <s.icon className="h-5 w-5 text-[var(--accent)] mb-3" />
              <div className="font-serif font-semibold">{s.title}</div>
              <div className="text-xs text-[var(--muted)] mt-1">{s.desc}</div>
            </button>
          ))}
        </section>
        <input
          ref={folderRef}
          type="file"
          className="hidden"
          multiple
          // @ts-expect-error webkitdirectory
          webkitdirectory=""
          onChange={async (e) => {
            if (!e.target.files) return;
            const files: { path: string; content: string }[] = [];
            for (const f of Array.from(e.target.files)) {
              const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
              if (!/\.(md|html|txt)$/i.test(path)) continue;
              files.push({ path, content: await f.text() });
            }
            if (files.length) setPendingImport(files);
            e.target.value = "";
          }}
        />

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "文档", value: documents.length },
            { label: "总字数", value: words },
            { label: "标签", value: tags.size },
            { label: "双链", value: backlinks },
          ].map((s) => (
            <div key={s.label} className="card-surface p-4">
              <div className="text-xs text-[var(--muted)]">{s.label}</div>
              <div className="font-serif text-3xl mt-1 tabular-nums">{s.value}</div>
            </div>
          ))}
        </section>

        {documents.length === 0 ? (
          <section className="card-surface p-10 text-center space-y-4">
            <div className="font-serif text-xl">书架空空如也</div>
            <p className="text-sm text-[var(--muted)]">新建一篇笔记，或恢复内置示例文档。</p>
            <div className="flex justify-center gap-2">
              <button type="button" className="rounded-xl bg-[var(--accent)] text-white px-4 py-2 text-sm" onClick={() => createDoc({ type: "md" })}>
                新建笔记
              </button>
              <button type="button" className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm" onClick={resetSeed}>
                恢复示例文档
              </button>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold">最近编辑</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map((d) => {
                const tags2 = getTags(d).slice(0, 2);
                const first = titleOf(d.path).charAt(0);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => openDoc(d.id)}
                    className="card-surface hover-lift text-left overflow-hidden flex flex-col min-h-[160px]"
                  >
                    <div className="relative flex-1 min-h-[88px] bg-[var(--hover)] overflow-hidden">
                      {d.type === "html" ? (
                        <iframe
                          title={titleOf(d.path)}
                          srcDoc={d.content}
                          sandbox=""
                          className="pointer-events-none origin-top-left"
                          style={{ width: "333%", height: "333%", transform: "scale(0.3)", border: 0 }}
                        />
                      ) : (
                        <div className="p-4 relative h-full">
                          <div className="absolute right-2 top-0 font-serif text-6xl opacity-[0.08]">{first}</div>
                          <p className="text-sm text-[var(--muted)] line-clamp-4 relative z-10">{mdExcerpt(d.content, 100)}</p>
                        </div>
                      )}
                    </div>
                    <div className="p-3 border-t border-[var(--border)]">
                      <div className="font-serif font-semibold truncate">{titleOf(d.path)}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                        {d.type === "html" ? <Globe className="h-3 w-3 text-[var(--teal)]" /> : <FilePlus2 className="h-3 w-3" />}
                        <span>{relativeTime(d.updatedAt)}</span>
                        {tags2.map((t) => (
                          <span key={t} className="rounded-full border border-[var(--border)] px-1.5">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {starred.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold flex items-center gap-2">
              <Star className="h-4 w-4 text-[var(--gold)]" /> 收藏
            </h2>
            <div className="flex flex-wrap gap-2">
              {starred.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => openDoc(d.id)}
                  className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm hover:bg-[var(--hover)]"
                >
                  {titleOf(d.path)}
                </button>
              ))}
            </div>
          </section>
        )}

        {tags.size > 0 && (
          <section className="space-y-3 pb-8">
            <h2 className="font-serif text-xl font-semibold">标签云</h2>
            <div className="flex flex-wrap gap-2">
              {[...tags.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTagFilter(t);
                    }}
                    className={cn(
                      "rounded-full border border-[var(--border)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors",
                      n > 2 ? "text-base" : "text-sm"
                    )}
                  >
                    {t} <span className="text-[var(--muted)]">{n}</span>
                  </button>
                ))}
            </div>
          </section>
        )}
      </div>
      <ImportFolderDialog
        open={!!pendingImport?.length}
        files={pendingImport}
        onClose={() => setPendingImport(null)}
      />
    </div>
  );
}
