import { NextRequest, NextResponse } from "next/server";
import { purgeTrashItem, restoreTrashItem } from "@/lib/storage/contentFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string; id?: string };
    if (!body.id) {
      return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
    }
    if (body.action === "restore") {
      const document = await restoreTrashItem(body.id);
      if (!document) {
        return NextResponse.json({ ok: false, error: "回收站中未找到" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, document });
    }
    if (body.action === "purge") {
      const ok = await purgeTrashItem(body.id);
      if (!ok) {
        return NextResponse.json({ ok: false, error: "回收站中未找到" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "未知 action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
