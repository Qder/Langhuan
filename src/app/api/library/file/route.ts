import { NextRequest, NextResponse } from "next/server";
import {
  ensureContentTree,
  ensureLibraryDir,
  hardDeletePath,
  readFileBytes,
  softDeleteDoc,
  writeQuizStore,
  writeTextDoc,
  QUIZ_INDEX_FILE,
} from "@/lib/storage/contentFs";
import { FS_INDEX_DIR } from "@/lib/storage/constants";
import { normalizeQuizStore } from "@/lib/quiz";
import { safeRelPath } from "@/lib/storage/pathSanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const pathParam = req.nextUrl.searchParams.get("path") || "";
    const file = await readFileBytes(pathParam);
    if (!file) {
      return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.buf), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "no-store",
        "X-Content-Path": encodeURIComponent(file.rel),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureContentTree();
    const body = (await req.json()) as {
      path?: string;
      content?: string;
      id?: string;
      starred?: boolean;
      createdAt?: number;
      updatedAt?: number;
      previousPath?: string;
      mkdirOnly?: string;
    };
    if (body.mkdirOnly) {
      await ensureLibraryDir(body.mkdirOnly);
      return NextResponse.json({ ok: true, mkdir: body.mkdirOnly });
    }
    if (!body.path || typeof body.content !== "string") {
      return NextResponse.json({ ok: false, error: "缺少 path/content" }, { status: 400 });
    }
    const rel = safeRelPath(body.path);
    // Meta file: content/.langhuan/quiz.json — do not index as a library document.
    if (rel === `${FS_INDEX_DIR}/${QUIZ_INDEX_FILE}` || rel === QUIZ_INDEX_FILE) {
      try {
        const parsed = normalizeQuizStore(JSON.parse(body.content));
        await writeQuizStore(parsed);
        return NextResponse.json({ ok: true, quiz: true, path: `${FS_INDEX_DIR}/${QUIZ_INDEX_FILE}` });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error: message || "quiz.json 无效" }, { status: 400 });
      }
    }
    const document = await writeTextDoc({
      path: body.path,
      content: body.content,
      id: body.id || `doc_${Date.now().toString(36)}`,
      starred: body.starred,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      previousPath: body.previousPath,
    });
    return NextResponse.json({ ok: true, document });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const pathParam = req.nextUrl.searchParams.get("path") || "";
    const mode = req.nextUrl.searchParams.get("mode") || "trash";
    if (!pathParam) {
      return NextResponse.json({ ok: false, error: "缺少 path" }, { status: 400 });
    }
    if (mode === "hard") {
      await hardDeletePath(pathParam);
      return NextResponse.json({ ok: true });
    }
    const item = await softDeleteDoc(pathParam);
    if (!item) {
      return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, trash: item });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
