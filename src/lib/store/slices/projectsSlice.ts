"use client";

import type { StateCreator } from "zustand";
import type { LanghuanState } from "../types";
import {
  projectEntryPath,
  projectMetaPath,
  serializeProjectMeta,
} from "../../project";
import { planProjectImport } from "../../importProject";
import type { CssFileIndex } from "../../locate/cssLocate";
import type { JsFileIndex } from "../../locate/jsIndex";
import { buildLibraryCssIndex, buildLibraryJsIndex, putLibraryRawFile } from "../../storage/contentApi";

type ProjectsSliceKeys =
  | "projects"
  | "projectTexts"
  | "importProject"
  | "openProjectEntry";

export type ProjectsSlice = Pick<LanghuanState, ProjectsSliceKeys>;

export type ImportProjectResult = {
  ok: boolean;
  message: string;
  root?: string;
};

/** 内联只认这几个类型，其余资源落盘即可。 */
const INLINE_TEXT_RE = /\.(css|js|mjs|cjs)$/i;

export const createProjectsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  ProjectsSlice
> = (set, get) => ({
  projects: [],
  projectTexts: {},
  importProject: async (name, files, opts) => {
    const existingPaths = [
      ...get().documents.map((d) => d.path),
      ...get().emptyFolders,
    ];
    const plan = planProjectImport({ name, files, existingPaths });
    if (!plan.ok) {
      get().setStatus(plan.reason);
      return { ok: false, message: plan.reason };
    }

    // 1) 资源先落盘（css/js/图片），失败就别留下半个项目
    try {
      for (const f of plan.rawText) {
        await putLibraryRawFile({ path: f.path, content: f.content });
      }
      for (const f of plan.rawBinary) {
        await putLibraryRawFile({ path: f.path, base64: f.base64 });
      }
      // 2) 元数据（.langhuan/project.json，不参与正文索引）
      await putLibraryRawFile({
        path: projectMetaPath(plan.root),
        content: serializeProjectMeta(plan.meta),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().setStatus(`项目导入失败：${msg}`);
      return { ok: false, message: msg };
    }

    // 3) 文档进库（index.html 等，路径已随项目根去重）
    get().importFiles(plan.docs, { quiet: true });

    // 3.5) CSS 索引（选择器 → 行号）：导入时就建好，预览里点元素立刻能跳
    const cssFiles = plan.rawText
      .filter((f) => /\.css$/i.test(f.path))
      .map((f) => f.path);
    if (cssFiles.length) {
      const indexes = (await Promise.all(cssFiles.map((f) => buildLibraryCssIndex(f)))).filter(
        (i): i is CssFileIndex => !!i
      );
      if (indexes.length) {
        set((s) => ({
          cssIndexes: [
            ...s.cssIndexes.filter((i) => !indexes.some((n) => n.file === i.file)),
            ...indexes,
          ].sort((a, b) => a.file.localeCompare(b.file, "zh")),
        }));
      }
    }

    // 3.6) JS 符号索引（函数 / 事件绑定 → 行号）：同样导入时就建好
    const jsFiles = plan.rawText.filter((f) => /\.(m?js|cjs)$/i.test(f.path)).map((f) => f.path);
    if (jsFiles.length) {
      const indexes = (await Promise.all(jsFiles.map((f) => buildLibraryJsIndex(f)))).filter(
        (i): i is JsFileIndex => !!i
      );
      if (indexes.length) {
        set((s) => ({
          jsIndexes: [
            ...s.jsIndexes.filter((i) => !indexes.some((n) => n.file === i.file)),
            ...indexes,
          ].sort((a, b) => a.file.localeCompare(b.file, "zh")),
        }));
      }
    }

    // 4) 预览内联用的文本缓存（css/js）
    const texts: Record<string, string> = {};
    const prefix = `${plan.root}/`;
    for (const f of plan.rawText) {
      const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : "";
      if (rel && INLINE_TEXT_RE.test(rel)) texts[rel] = f.content;
    }
    set((s) => ({
      projects: [...s.projects.filter((p) => p.root !== plan.root), plan.meta],
      projectTexts: { ...s.projectTexts, [plan.root]: texts },
    }));

    const entry = projectEntryPath(plan.meta);
    const entryDoc = get().documents.find((d) => d.path === entry);
    if (entryDoc) get().openDoc(entryDoc.id);
    void get().refreshStorageUsage();

    const parts = [`已导入项目 ${plan.root}`, `${plan.meta.files.length} 个文件`];
    if (plan.meta.external.length) parts.push(`${plan.meta.external.length} 个外链已跳过`);
    if (plan.skipped.length) parts.push(`忽略 ${plan.skipped.length} 个`);
    const message = parts.join(" · ");
    if (!opts?.quiet) get().setStatus(message);
    return { ok: true, message, root: plan.root };
  },

  openProjectEntry: (root) => {
    const project = get().projects.find((p) => p.root === root);
    if (!project) {
      get().setStatus("项目不存在");
      return;
    }
    const path = projectEntryPath(project);
    const doc = get().documents.find((d) => d.path === path);
    if (!doc) {
      get().setStatus(`入口文件 ${project.entry} 缺失`);
      return;
    }
    get().openDoc(doc.id);
  },
});
