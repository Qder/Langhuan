import { currentAppVersion, isTauriAndroid } from "./desktop/updater";
import { readAndroidAppVersion } from "./android/updater";

/** Source-maintained notes for this UI build, not a claim that a release is published. */
export const BUNDLED_BUILD_ID = "reader-tablet-20261110";
export const BUNDLED_NOTES = "本构建改动（尚不代表远程已发布）：\n• 专注/沉浸显示时间与可用电量。\n• 读码讲解支持平板调宽、全屏与返回代码，选区快捷讲解及上下文清单。\n• 生成阶段、取消与失败重试改进；设置长说明默认收起。\n• ZIP 导入可查跳过原因，支持旧编码中文文件名。\n• 当前版本与更新说明可再次查看。";
const SEEN_KEY = "langhuan-release-notes-seen";
const CACHE_PREFIX = "langhuan-release-notes:";
export type AppBuild = { id: string; label: string };
export const androidBuildId = (versionName: string, versionCode: number) => `android:${versionName}:${versionCode}`;
export async function readCurrentBuild(): Promise<AppBuild> {
  if (isTauriAndroid()) {
    const version = await readAndroidAppVersion();
    return { id: androidBuildId(version.versionName, version.versionCode), label: `${version.versionName} · versionCode ${version.versionCode}` };
  }
  const version = await currentAppVersion();
  return version === "浏览器" ? { id: `web:${BUNDLED_BUILD_ID}`, label: "浏览器 · 本地前端构建" } : { id: `desktop:${version}`, label: version };
}
export function cacheReleaseNotes(id: string, notes: string): void {
  try { if (notes.trim()) localStorage.setItem(CACHE_PREFIX + id, notes); } catch { /* no persistence */ }
}
export function releaseNotesFor(build: AppBuild): string {
  try { return localStorage.getItem(CACHE_PREFIX + build.id) || BUNDLED_NOTES; } catch { return BUNDLED_NOTES; }
}
/** Version identity only: rebuilding the same native version never opens another notice. */
export function shouldShowReleaseNotes(build: AppBuild): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== build.id; } catch { return false; }
}
export function markReleaseNotesSeen(build: AppBuild): void {
  try { localStorage.setItem(SEEN_KEY, build.id); } catch { /* no persistence */ }
}
