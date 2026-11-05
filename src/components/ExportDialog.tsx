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
import type { ExportAssetReader } from "@/lib/export/renderMarkdown";
import { fetchProjectAsset } from "@/lib/storage/contentApi";
import { downloadBlob } from "@/lib/shortcuts";
import { basename } from "@/lib/utils";

/** 超过这个体积不内联：单篇 HTML 里塞一张 40MB 的图只会让文件打不开。 */
const INLINE_ASSET_LIMIT = 20 * 1024 * 1024;

/**
 * 导出时的媒体读取器：走库里的同一套读文件接口（浏览器 / Tauri 都通）。
 * 读不到或太大就回 null，让导出渲染成「图片未找到」的说明块。
 */
const readExportAsset: ExportAssetReader = async (path) => {
  try {
    const file = await fetchProjectAsset(path, { maxBytes: INLINE_ASSET_LIMIT });
    if (!file || file === "too-large") return null;
    return { mime: file.mime, base64: file.base64 };
  } catch {
    return null;
  }
};

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

  const buildStandalone = (doc: (typeof documents)[number]) =>
    documentToStandaloneHtml(doc, {
      content: getContent(doc.id),
      docs: documents,
      readAsset: readExportAsset,
    });

  const exportStandalone = async () => {
    const doc = selectedDocs[0] || active;
    if (!doc) return;
    setBusy(true);
    try {
      const html = await buildStandalone(doc);
      downloadBlob(
        new Blob([html], { type: "text/html;charset=utf-8" }),
        suggestExportFilename(doc, "html")
      );
      setStatus(`已导出独立 HTML：${suggestExportFilename(doc, "html")}（图片已内联）`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const exportPdfPrint = async () => {
    const doc = selectedDocs[0] || active;
    if (!doc) return;
    setBusy(true);
    try {
      const html = await buildStandalone(doc);
      openPrintWindow(html);
      setStatus("已打开打印预览，请选择「另存为 PDF」");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "打印失败");
    } finally {
      setBusy(false);
    }
  };

  const exportSite = async () => {
    setBusy(true);
    try {
      const blob = await buildStaticSiteZip({
        documents,
        getContent: (id) => getContent(id),
        readAsset: readExportAsset,
      });
      const name = `langhuan-site-${new Date().toISOString().slice(0, 10)}.zip`;
      downloadBlob(blob, name);
      setStatus(`已导出静态站点 ${name}（${documents.length} 篇，含离线资源）`);
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
      // 选中多篇时也走完整的静态站点构建：双链能在选中集合内互跳，
      // 图片落在同一个 assets/ 里，不会被复制成一堆内联大文件。
      const blob = await buildStaticSiteZip({
        documents: selectedDocs,
        getContent: (id) => getContent(id),
        readAsset: readExportAsset,
      });
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
            disabled={busy || (!active && selectedDocs.length !== 1)}
            onClick={() => void exportStandalone()}
          >
            <FileCode2 className="h-4 w-4" /> 独立 HTML（内嵌样式）
          </Button>
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={busy || (!active && selectedDocs.length !== 1)}
            onClick={() => void exportPdfPrint()}
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
          独立 HTML 把图片内联进文件，发出去就能看；静态站点把用到的资源收进{" "}
          <code>assets/</code>，解压即用。双链在导出范围内可点，范围外会标成不可点的胶囊；
          图片读不到时渲染成「图片未找到」的说明块，而不是碎图。
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
