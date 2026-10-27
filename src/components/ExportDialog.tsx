"use client";

import * as React from "react";
import { Download, FileCode2, FileText, Globe2, Printer } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  documentToStandaloneHtml,
  openPrintWindow,
  suggestExportFilename,
} from "@/lib/export/standalone";
import { buildStaticSiteZip } from "@/lib/export/staticSite";
import { downloadBlob } from "@/lib/shortcuts";
import { basename } from "@/lib/utils";

export function ExportDialog() {
  const open = useStore((s) => s.exportDialogOpen);
  const setOpen = useStore((s) => s.setExportDialogOpen);
  const getActive = useStore((s) => s.getActive);
  const getContent = useStore((s) => s.getContent);
  const documents = useStore((s) => s.documents);
  const setStatus = useStore((s) => s.setStatus);
  const treeSelection = useStore((s) => s.treeSelection);
  const [busy, setBusy] = React.useState(false);

  const active = getActive();
  const selectedDocs =
    treeSelection.length > 0
      ? documents.filter((d) => treeSelection.includes(d.id))
      : active
        ? [active]
        : [];

  const exportSource = () => {
    const doc = selectedDocs[0] || active;
    if (!doc) return;
    const blob = new Blob([getContent(doc.id)], {
      type: doc.type === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    downloadBlob(blob, suggestExportFilename(doc, "source"));
    setStatus(`已导出 ${basename(doc.path)}`);
  };

  const exportStandalone = () => {
    const doc = selectedDocs[0] || active;
    if (!doc) return;
    const html = documentToStandaloneHtml(doc, getContent(doc.id));
    downloadBlob(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      suggestExportFilename(doc, "html")
    );
    setStatus(`已导出独立 HTML：${suggestExportFilename(doc, "html")}`);
  };

  const exportPdfPrint = () => {
    const doc = selectedDocs[0] || active;
    if (!doc) return;
    try {
      const html = documentToStandaloneHtml(doc, getContent(doc.id));
      openPrintWindow(html);
      setStatus("已打开打印预览，请选择「另存为 PDF」");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "打印失败");
    }
  };

  const exportSite = async () => {
    setBusy(true);
    try {
      const blob = await buildStaticSiteZip({
        documents,
        getContent: (id) => getContent(id),
      });
      const name = `langhuan-site-${new Date().toISOString().slice(0, 10)}.zip`;
      downloadBlob(blob, name);
      setStatus(`已导出静态站点 ${name}（${documents.length} 篇）`);
      setOpen(false);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "静态站点导出失败");
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedZip = async () => {
    if (!selectedDocs.length) return;
    setBusy(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const d of selectedDocs) {
        const html = documentToStandaloneHtml(d, getContent(d.id));
        const name = d.path.replace(/\\/g, "/").replace(/\.md$/i, ".html");
        zip.file(name.endsWith(".html") ? name : name + ".html", html);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `langhuan-selected-${selectedDocs.length}.zip`);
      setStatus(`已导出选中 ${selectedDocs.length} 篇`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="export-title">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="export-title" className="text-lg font-semibold font-ui">
            导出
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            {selectedDocs.length > 1
              ? `已选 ${selectedDocs.length} 篇`
              : active
                ? `当前：${active.path}`
                : "请先打开或勾选文档"}
          </p>
        </div>

        <div className="grid gap-2">
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={!active && !selectedDocs.length}
            onClick={exportSource}
          >
            <FileText className="h-4 w-4" /> 导出源码（.md / .html）
          </Button>
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={!active && selectedDocs.length !== 1}
            onClick={exportStandalone}
          >
            <FileCode2 className="h-4 w-4" /> 独立 HTML（内嵌样式）
          </Button>
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={!active && selectedDocs.length !== 1}
            onClick={exportPdfPrint}
          >
            <Printer className="h-4 w-4" /> 打印 / 另存 PDF
          </Button>
          {selectedDocs.length > 1 && (
            <Button
              variant="secondary"
              className="justify-start gap-2"
              disabled={busy}
              onClick={() => void exportSelectedZip()}
            >
              <Download className="h-4 w-4" /> 导出选中为 zip
            </Button>
          )}
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={busy || !documents.length}
            onClick={() => void exportSite()}
          >
            <Globe2 className="h-4 w-4 text-[var(--teal)]" /> 整库静态站点 zip
          </Button>
        </div>

        <p className="text-xs text-[var(--muted)] leading-relaxed">
          PDF 走浏览器打印引擎（MVP）。静态站点含 <code>index.html</code> 与各篇独立页面，可直接发布到任意静态托管。
        </p>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
