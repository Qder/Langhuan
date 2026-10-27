import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normalize CRLF/CR to LF so locate offsets match CodeMirror (LF-only docs). */
export function normalizeNewlines(text: string): string {
  if (!text) return text;
  if (!text.includes("\r")) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function uid(prefix = "doc"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function extOf(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function titleOf(path: string): string {
  const name = basename(path);
  return name.replace(/\.(md|html|txt)$/i, "");
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

export function countWords(text: string): number {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return cn + en;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / 400));
}

export function greetingByHour(h = new Date().getHours()): string {
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export function uniquePath(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;
  const m = desired.match(/^(.*?)(\.[^.]+)?$/);
  const base = m?.[1] ?? desired;
  const ext = m?.[2] ?? "";
  let i = 2;
  while (existing.has(`${base}-${i}${ext}`)) i += 1;
  return `${base}-${i}${ext}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mdExcerpt(content: string, n = 120): string {
  const body = content.replace(/^---[\s\S]*?---\s*/, "").replace(/[#>*`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim();
  return body.slice(0, n) + (body.length > n ? "…" : "");
}
