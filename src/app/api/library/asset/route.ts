import { NextRequest, NextResponse } from "next/server";
import { writeAssetBinary } from "@/lib/storage/contentFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      path?: string;
      base64?: string;
      mime?: string;
      id?: string;
      docId?: string;
      createdAt?: number;
    };
    if (!body.path || typeof body.base64 !== "string") {
      return NextResponse.json({ ok: false, error: "缺少 path/base64" }, { status: 400 });
    }
    const buf = Buffer.from(body.base64, "base64");
    const asset = await writeAssetBinary({
      path: body.path,
      data: buf,
      mime: body.mime,
      id: body.id,
      docId: body.docId,
      createdAt: body.createdAt,
    });
    return NextResponse.json({ ok: true, asset });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
