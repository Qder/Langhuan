import { NextRequest, NextResponse } from "next/server";
import {
  snapshotBackupLibrary,
  stageBackupLibrary,
  applyStagedBackup,
  storeAutomaticBackup,
  listAutomaticBackups,
  readAutomaticBackup,
  readBackupRestoreState,
  readStagedBackup,
} from "@/lib/storage/contentFs";
import type { BackupTree } from "@/lib/storage/backupProtocol";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const q = (await req.json()) as {
      action: string;
      tree: BackupTree;
      mode: "merge" | "replace";
      expectedFingerprint: string;
      id: string;
      base64: string;
      keep: number;
      name: string;
    };
    let result: unknown;
    switch (q.action) {
      case "snapshot":
        result = await snapshotBackupLibrary();
        break;
      case "state":
        result = await readBackupRestoreState();
        break;
      case "stage":
        if (!["merge", "replace"].includes(q.mode))
          throw new Error("恢复模式无效");
        result = await stageBackupLibrary(
          q.tree,
          q.mode,
          q.expectedFingerprint,
        );
        break;
      case "read-stage":
        result = await readStagedBackup(q.id);
        break;
      case "apply":
        result = await applyStagedBackup(q.id);
        break;
      case "save-auto":
        result = await storeAutomaticBackup(q.base64, q.keep);
        break;
      case "list-auto":
        result = await listAutomaticBackups();
        break;
      case "read-auto":
        result = await readAutomaticBackup(q.name);
        break;
      default:
        throw new Error("备份操作无效");
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
