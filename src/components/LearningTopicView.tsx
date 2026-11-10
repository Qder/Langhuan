"use client";

import * as React from "react";
import { ArrowLeft, BookMarked, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { titleOf, mdExcerpt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type LearningTopicCitationRef } from "@/lib/learningTopics";
import {
  listCitationsInNote,
  resolveTopicCitation,
} from "@/lib/learningTopicCitations";
import { followNoteSourceCitation } from "@/lib/ide/followNoteSourceCitation";
import { ideLinkLabel } from "@/lib/ide/ideLink";


function TopicIdentityFields({
  topicId,
  title,
  description,
  onRename,
  onDescribe,
}: {
  topicId: string;
  title: string;
  description: string;
  onRename: (id: string, title: string) => void;
  onDescribe: (id: string, description: string) => void;
}) {
  const [titleDraft, setTitleDraft] = React.useState(title);
  const [descDraft, setDescDraft] = React.useState(description);
  return (
    <>
      <input
        className="w-full font-serif text-2xl md:text-3xl font-bold bg-transparent outline-none min-h-11"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => onRename(topicId, titleDraft)}
        aria-label="专题标题"
      />
      <textarea
        className="w-full text-sm text-[var(--muted)] bg-transparent outline-none resize-y min-h-[72px]"
        placeholder="可选说明（不复制笔记正文）"
        value={descDraft}
        onChange={(e) => setDescDraft(e.target.value)}
        onBlur={() => onDescribe(topicId, descDraft)}
        aria-label="专题说明"
      />
    </>
  );
}

export function LearningTopicView() {
  const activeTopicId = useStore((s) => s.activeTopicId);
  const topics = useStore((s) => s.learningTopics);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const openHome = useStore((s) => s.requestOpenHome);
  const setActiveTopicId = useStore((s) => s.setActiveTopicId);
  const renameLearningTopic = useStore((s) => s.renameLearningTopic);
  const setLearningTopicDescription = useStore((s) => s.setLearningTopicDescription);
  const deleteLearningTopic = useStore((s) => s.deleteLearningTopic);
  const addLearningTopicNote = useStore((s) => s.addLearningTopicNote);
  const removeLearningTopicNote = useStore((s) => s.removeLearningTopicNote);
  const addLearningTopicCitation = useStore((s) => s.addLearningTopicCitation);
  const removeLearningTopicCitation = useStore((s) => s.removeLearningTopicCitation);
  const setStatus = useStore((s) => s.setStatus);

  const topic = topics.find((t) => t.id === activeTopicId);
  const [pickingNotes, setPickingNotes] = React.useState(false);
  const [pickingCites, setPickingCites] = React.useState(false);

  const citeChoices = React.useMemo(() => {
    const source = documents;
    const existing = new Set(
      (topic?.citations ?? []).map(
        (c) => `${c.noteId}\0${c.projectId}\0${c.path}\0${c.fromLine}\0${c.toLine}\0${c.capturedAt ?? ""}`
      )
    );
    const out: Array<{
      ref: LearningTopicCitationRef;
      label: string;
      noteTitle: string;
    }> = [];
    for (const d of source) {
      for (const hit of listCitationsInNote(d.id, getContent(d.id))) {
        const key = `${hit.ref.noteId}\0${hit.ref.projectId}\0${hit.ref.path}\0${hit.ref.fromLine}\0${hit.ref.toLine}\0${hit.ref.capturedAt ?? ""}`;
        if (existing.has(key)) continue;
        out.push({
          ref: hit.ref,
          label: ideLinkLabel(
            {
              path: hit.citation.path,
              line: hit.citation.fromLine,
              endLine: hit.citation.toLine,
            },
            80
          ),
          noteTitle: titleOf(d.path),
        });
      }
    }
    return out;
  }, [documents, getContent, topic]);


  if (!topic) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-4">
          <p className="text-[var(--muted)]">这个专题已经不在了。</p>
          <Button variant="outline" size="lg" onClick={() => setActiveTopicId(null)}>
            返回学习专题
          </Button>
        </div>
      </div>
    );
  }

  const notes = topic.noteIds.map((id) => ({
    id,
    doc: documents.find((d) => d.id === id),
  }));
  const availableNotes = documents.filter((d) => !topic.noteIds.includes(d.id));
  const jump = async (ref: LearningTopicCitationRef) => {
    const doc = documents.find((d) => d.id === ref.noteId);
    const resolved = resolveTopicCitation(ref, doc ? getContent(doc.id) : null);
    if (!resolved.ok) {
      const msg =
        resolved.reason === "missing-note"
          ? "引用所在的笔记已不在书库，无法跳回源码。"
          : "笔记里已找不到这条引用，无法跳回源码。";
      setStatus(msg);
      return;
    }
    await followNoteSourceCitation(resolved.citation);
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-8 animate-enter">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            onClick={() => setActiveTopicId(null)}
            aria-label="返回学习专题列表"
          >
            <ArrowLeft className="h-4 w-4" />
            返回专题列表
          </Button>
          <Button variant="ghost" size="lg" className="min-h-11" onClick={() => openHome()}>
            返回首页
          </Button>
        </div>

        <section className="card-surface p-5 md:p-6 space-y-3">
          <div className="flex items-center gap-2 text-[var(--muted)] text-sm font-ui">
            <BookMarked className="h-4 w-4" />
            学习专题
          </div>
          <TopicIdentityFields
            key={topic.id}
            topicId={topic.id}
            title={topic.title}
            description={topic.description}
            onRename={renameLearningTopic}
            onDescribe={setLearningTopicDescription}
          />
          <Button
            variant="danger"
            size="lg"
            className="min-h-11"
            onClick={() => {
              if (typeof window !== "undefined" && !window.confirm(`删除专题「${topic.title}」？笔记本身不会被删除。`)) {
                return;
              }
              deleteLearningTopic(topic.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
            删除专题
          </Button>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-xl font-semibold">笔记</h2>
            <Button
              variant="outline"
              size="lg"
              className="min-h-11"
              onClick={() => setPickingNotes((v) => !v)}
            >
              <Plus className="h-4 w-4" />
              {pickingNotes ? "收起" : "添加已有笔记"}
            </Button>
          </div>
          {pickingNotes && (
            <div className="card-surface p-3 space-y-2">
              {availableNotes.length === 0 ? (
                <p className="text-sm text-[var(--muted)] px-2 py-2">没有可添加的笔记。</p>
              ) : (
                availableNotes.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="w-full text-left rounded-xl px-3 py-3 min-h-11 hover:bg-[var(--hover)]"
                    onClick={() => addLearningTopicNote(topic.id, d.id)}
                  >
                    <div className="font-serif font-semibold truncate">{titleOf(d.path)}</div>
                    <div className="text-xs text-[var(--muted)] line-clamp-1">
                      {mdExcerpt(d.content, 80)}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          {notes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">还没有放入笔记。专题只引用已有笔记，不会复制正文。</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {notes.map(({ id, doc }) => (
                <div key={id} className="card-surface p-4 flex flex-col gap-3 min-h-[120px]">
                  {doc ? (
                    <>
                      <button
                        type="button"
                        className="text-left font-serif font-semibold truncate min-h-11"
                        onClick={() => openDoc(doc.id)}
                      >
                        {titleOf(doc.path)}
                      </button>
                      <p className="text-sm text-[var(--muted)] line-clamp-2">
                        {mdExcerpt(doc.content, 100)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--muted)]">这篇笔记已不在书库。</p>
                  )}
                  <Button
                    variant="ghost"
                    size="lg"
                    className="self-start min-h-11"
                    onClick={() => removeLearningTopicNote(topic.id, id)}
                  >
                    移出专题
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-xl font-semibold">源码引用</h2>
            <Button
              variant="outline"
              size="lg"
              className="min-h-11"
              onClick={() => setPickingCites((v) => !v)}
            >
              <Plus className="h-4 w-4" />
              {pickingCites ? "收起" : "从笔记引用添加"}
            </Button>
          </div>
          {pickingCites && (
            <div className="card-surface p-3 space-y-2">
              {citeChoices.length === 0 ? (
                <p className="text-sm text-[var(--muted)] px-2 py-2">
                  现有笔记里没有尚未加入的 `lh-cite` 引用。
                </p>
              ) : (
                citeChoices.map((c) => (
                  <button
                    key={`${c.ref.noteId}:${c.ref.path}:${c.ref.fromLine}`}
                    type="button"
                    className="w-full text-left rounded-xl px-3 py-3 min-h-11 hover:bg-[var(--hover)]"
                    onClick={() => addLearningTopicCitation(topic.id, c.ref)}
                  >
                    <div className="font-mono text-sm truncate">{c.label}</div>
                    <div className="text-xs text-[var(--muted)]">来自 {c.noteTitle}</div>
                  </button>
                ))
              )}
            </div>
          )}
          {topic.citations.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              还没有源码引用。引用指向笔记里已有的 lh-cite，不另存快照副本。
            </p>
          ) : (
            <div className="space-y-3">
              {topic.citations.map((ref) => {
                const doc = documents.find((d) => d.id === ref.noteId);
                const resolved = resolveTopicCitation(ref, doc ? getContent(doc.id) : null);
                const label = ideLinkLabel(
                  { path: ref.path, line: ref.fromLine, endLine: ref.toLine },
                  80
                );
                return (
                  <div key={ref.id} className="card-surface p-4 space-y-2">
                    <div className="font-mono text-sm truncate" title={label}>
                      {label}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {doc ? `来自 ${titleOf(doc.path)}` : "引用所在的笔记已不在书库"}
                    </div>
                    {resolved.ok ? (
                      <pre className="text-[13px] overflow-x-auto max-h-40 p-2 rounded-xl bg-[var(--hover)]">
                        <code>{resolved.citation.snapshot}</code>
                      </pre>
                    ) : (
                      <p className="text-sm text-[var(--gold)]">
                        {resolved.reason === "missing-note"
                          ? "找不到原笔记，无法展示快照。"
                          : "笔记里已找不到这条引用，无法展示快照。"}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="accent"
                        size="lg"
                        className="min-h-11"
                        onClick={() => void jump(ref)}
                      >
                        跳回源码
                      </Button>
                      {doc && (
                        <Button
                          variant="outline"
                          size="lg"
                          className="min-h-11"
                          onClick={() => openDoc(doc.id)}
                        >
                          打开笔记
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="lg"
                        className="min-h-11"
                        onClick={() => removeLearningTopicCitation(topic.id, ref.id)}
                      >
                        移出专题
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function topicSummary(topic: { noteIds: string[]; citations: unknown[] }): string {
  const notes = topic.noteIds.length;
  const cites = topic.citations.length;
  const bits: string[] = [];
  if (notes) bits.push(`${notes} 篇笔记`);
  if (cites) bits.push(`${cites} 条引用`);
  return bits.join(" · ") || "还没有笔记或引用";
}
