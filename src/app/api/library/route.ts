import { NextResponse } from "next/server";
import { scanLibrary, ensureContentTree } from "@/lib/storage/contentFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureContentTree();
    const snap = await scanLibrary();
    return NextResponse.json({
      ok: true,
      source: "content",
      documents: snap.documents,
      assets: snap.assets,
      trash: snap.trash,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message, hint: "需要 Node 运行时（npm run dev / next start）读写 content/" },
      { status: 500 }
    );
  }
}
