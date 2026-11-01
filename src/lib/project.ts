/**
 * 项目（多文件站点）元数据。
 *
 * 一个「项目」是 content/<项目名>/ 下的一整棵目录树，入口页引用同目录（或子目录）里的
 * 样式 / 脚本。元数据存在 content/<项目名>/.langhuan/project.json：
 *
 *   { "entry": "index.html", "files": ["index.html","css/style.css"], "external": [], "importedAt": "…" }
 *
 * `.langhuan/` 目录不参与正文扫描（见 contentFs.walkFiles），所以 project.json 不会被
 * 当成一篇文档索引。
 */

/** 项目元数据目录名（与库级 `.langhuan` 同名，扫描时按目录名跳过）。 */
export const PROJECT_META_DIR = ".langhuan";

export const PROJECT_META_FILE = "project.json";

/** project.json 的磁盘形状（章节式，字段名是外部契约，勿随意改）。 */
export type ProjectMetaFile = {
  entry: string;
  files: string[];
  external: string[];
  importedAt: string;
};

/** 运行期项目元数据：磁盘形状 + 项目根路径。 */
export type ProjectMeta = ProjectMetaFile & {
  /** 库内相对路径，如 "demo-site"。 */
  root: string;
};

/** content/<root>/.langhuan/project.json */
export function projectMetaPath(root: string): string {
  const r = normalizeProjectRel(root);
  return r ? `${r}/${PROJECT_META_DIR}/${PROJECT_META_FILE}` : `${PROJECT_META_DIR}/${PROJECT_META_FILE}`;
}

/** 去掉 `./`、多余分隔符与首尾斜杠；不做 `..` 解析（库内路径已由 safeRelPath 处理）。 */
export function normalizeProjectRel(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((s) => s && s !== ".")
    .join("/");
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const p = normalizeProjectRel(item);
    if (p) out.push(p);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, "zh"));
}

/**
 * 校验并规整 project.json。缺 entry 或 files 视为无效（返回 null，调用方跳过该项目）。
 * entry 必须落在 files 内——两者不一致时以 entry 为准补进去，避免「项目打不开」。
 */
export function parseProjectMeta(raw: unknown, root: string): ProjectMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const entry = typeof obj.entry === "string" ? normalizeProjectRel(obj.entry) : "";
  if (!entry) return null;
  const files = strList(obj.files);
  if (!files.length) return null;
  if (!files.includes(entry)) files.push(entry);
  const external = Array.isArray(obj.external)
    ? [...new Set(obj.external.filter((x): x is string => typeof x === "string" && !!x.trim()))]
    : [];
  const importedAt =
    typeof obj.importedAt === "string" && obj.importedAt.trim()
      ? obj.importedAt
      : new Date(0).toISOString();
  return {
    root: normalizeProjectRel(root),
    entry,
    files: files.sort((a, b) => a.localeCompare(b, "zh")),
    external,
    importedAt,
  };
}

/** 序列化时只写契约里的四个字段（形状稳定，便于手工编辑与 diff）。 */
export function serializeProjectMeta(meta: ProjectMeta): string {
  const payload: ProjectMetaFile = {
    entry: meta.entry,
    files: [...meta.files].sort((a, b) => a.localeCompare(b, "zh")),
    external: [...meta.external],
    importedAt: meta.importedAt,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** 入口页在库内的路径：`<root>/<entry>`。 */
export function projectEntryPath(meta: ProjectMeta): string {
  return normalizeProjectRel(`${meta.root}/${meta.entry}`);
}

/** 该库内路径是否在项目内（根目录本身也算）。 */
export function isPathInProject(path: string, root: string): boolean {
  const p = normalizeProjectRel(path);
  const r = normalizeProjectRel(root);
  if (!p || !r) return false;
  return p === r || p.startsWith(`${r}/`);
}

/** 路径 → 项目（多项目嵌套时取最深的根）。 */
export function findProjectForPath(
  path: string,
  projects: ProjectMeta[]
): ProjectMeta | null {
  let best: ProjectMeta | null = null;
  for (const p of projects) {
    if (!isPathInProject(path, p.root)) continue;
    if (!best || normalizeProjectRel(p.root).length > normalizeProjectRel(best.root).length) {
      best = p;
    }
  }
  return best;
}

/** 项目内相对路径（不在项目内返回 ""）。 */
export function projectRelPath(path: string, root: string): string {
  if (!isPathInProject(path, root)) return "";
  const p = normalizeProjectRel(path);
  const r = normalizeProjectRel(root);
  return p === r ? "" : p.slice(r.length + 1);
}
