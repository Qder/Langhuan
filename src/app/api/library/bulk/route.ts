import { NextRequest, NextResponse } from "next/server";
import type { AssetMeta, Document, TrashItem } from "@/lib/types";
import {
  ensureContentTree,
  scanLibrary,
  writeAssetBinary,
  writeTextDoc,
  writeTrashIndex,
} from "@/lib/storage/contentFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureContentTree();
    const body = (await req.json()) as {
      documents?: Document[];
      assets?: Array<AssetMeta & { base64?: string }>;
      trash?: TrashItem[];
      seed?: boolean;
    };
    const docs = Array.isArray(body.documents) ? body.documents : [];
    for (const d of docs) {
      if (!d?.path || typeof d.content !== "string") continue;
      await writeTextDoc({
        path: d.path,
        content: d.content,
        id: d.id,
        starred: d.starred,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      });
    }
    const assets = Array.isArray(body.assets) ? body.assets : [];
    for (const a of assets) {
      if (!a?.path) continue;
      if (a.base64) {
        await writeAssetBinary({
          path: a.path,
          data: Buffer.from(a.base64, "base64"),
          mime: a.mime,
          id: a.id,
          docId: a.docId,
          createdAt: a.createdAt,
        });
      }
    }
    if (Array.isArray(body.trash)) {
      await writeTrashIndex(body.trash);
    }
    const snap = await scanLibrary();
    return NextResponse.json({
      ok: true,
      source: "content",
      seeded: !!body.seed,
      documents: snap.documents,
      assets: snap.assets,
      trash: snap.trash,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
