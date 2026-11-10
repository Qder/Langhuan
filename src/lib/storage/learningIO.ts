"use client";
import { fetchLearningFile, putLearningFile } from "./contentApi";
import type { LearningFile } from "./learningData";
export type LearningIO = { read: (path: string) => Promise<LearningFile | null>; write: (path: string, value: LearningFile) => Promise<void> };
export const libraryLearningIO: LearningIO = { read: (p) => fetchLearningFile(p), write: (p, v) => putLearningFile(p, v) };
let report: (message: string) => void = () => {};
export function setLearningErrorHandler(handler: (message: string) => void): void { report = handler; }
export function reportLearningError(path: string, error: unknown): void {
  report(`学习数据 ${path} 保存/读取失败，旧数据已保留，可重试：${error instanceof Error ? error.message : String(error)}`);
}
const blockedReads = new Set<string>();
export function setLearningReadBlocked(path: string, blocked: boolean): void {
  if (blocked) blockedReads.add(path); else blockedReads.delete(path);
}
export function isLearningReadBlocked(path: string): boolean { return blockedReads.has(path); }
const queues = new Map<string, Promise<unknown>>();
export function serializeLearning<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(path) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined); queues.set(path, tail);
  void tail.then(() => { if (queues.get(path) === tail) queues.delete(path); });
  return run;
}
export async function persistLearningFile(path: string, value: LearningFile): Promise<void> {
  try {
    await serializeLearning(path, async () => {
      if (blockedReads.has(path)) throw new Error("主库读取未成功，拒绝以不完整旧副本覆盖；请修复文件/连接后重新载入知识库");
      await libraryLearningIO.write(path, value);
    });
  }
  catch (e) { reportLearningError(path, e); throw e; }
}

export async function waitForLearningWrites(): Promise<void> { await Promise.all([...queues.values()]); }
