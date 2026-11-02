import { NextRequest, NextResponse } from "next/server";
import {
  ensureContentTree,
  ensureLibraryDir,
  hardDeletePath,
  readFileBytes,
  softDeleteDoc,
  writeCssIndex,
  writeJsIndex,
  writeQuizStore,
  writeRawBase64File,
  writeRawTextFile,
  writeTextDoc,
  QUIZ_INDEX_FILE,
} from "@/lib/storage/contentFs";
import { buildCssIndex } from "@/lib/locate/cssLocate";
import { buildJsIndex } from "@/lib/locate/jsIndex";

/** 超过这个体积的 CSS 不建索引（解析 + 行号本来也没意义）。 */
const CSS_INDEX_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** 同理，超过这个体积的 JS 不建索引。 */
const JS_INDEX_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
import { FS_INDEX_DIR } from "@/lib/storage/constants";
import { normalizeQuizStore } from "@/lib/quiz";
import { safeRelPath } from "@/lib/storage/pathSanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject raw `..` segments before sanitize (safeRelPath would otherwise strip them). */
function pathHasTraversal(p: string): boolean {
  return p.replace(/\\/g, "/").split("/").some((seg) => seg === "..");
}

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
      /** 项目资源：原样写盘，不进正文索引 */
      raw?: boolean;
      /** 二进制内容（配合 raw 使用） */
      base64?: string;
      /** 建 CSS 索引：服务端读源文件 → postcss 解析 → 写 .langhuan/index/css/ */
      cssIndex?: boolean;
      /** 建 JS 索引：服务端读源文件 → acorn 解析 → 写 .langhuan/index/js/ */
      jsIndex?: boolean;
      /** 待建索引的 CSS 文件（库内相对路径） */
      file?: string;
    };
    const traversalTarget =
      (body.path && pathHasTraversal(body.path) && body.path) ||
      (body.previousPath && pathHasTraversal(body.previousPath) && body.previousPath) ||
      (body.mkdirOnly && pathHasTraversal(body.mkdirOnly) && body.mkdirOnly) ||
      (body.file && pathHasTraversal(body.file) && body.file) ||
      "";
    if (traversalTarget) {
      return NextResponse.json({ ok: false, error: "路径越界" }, { status: 400 });
    }
    if (body.mkdirOnly) {
      await ensureLibraryDir(body.mkdirOnly);
      return NextResponse.json({ ok: true, mkdir: body.mkdirOnly });
    }
    if (body.cssIndex) {
      const file = safeRelPath(body.file || "");
      if (!file || !/\.css$/i.test(file)) {
        return NextResponse.json({ ok: false, error: "只支持为 .css 建索引" }, { status: 400 });
      }
      const raw = await readFileBytes(file);
      if (!raw) {
        return NextResponse.json({ ok: false, error: "CSS 文件不存在" }, { status: 404 });
      }
      if (raw.buf.byteLength > CSS_INDEX_MAX_SOURCE_BYTES) {
        return NextResponse.json({ ok: false, error: "CSS 文件过大，未建索引" }, { status: 400 });
      }
      const index = await buildCssIndex(file, new TextDecoder().decode(raw.buf));
      const written = await writeCssIndex(index);
      return NextResponse.json({ ok: true, cssIndex: true, path: written, index });
    }
    if (body.jsIndex) {
      const file = safeRelPath(body.file || "");
      if (!file || !/\.(m?js|cjs)$/i.test(file)) {
        return NextResponse.json({ ok: false, error: "只支持为 .js 建索引" }, { status: 400 });
      }
      const raw = await readFileBytes(file);
      if (!raw) {
        return NextResponse.json({ ok: false, error: "JS 文件不存在" }, { status: 404 });
      }
      if (raw.buf.byteLength > JS_INDEX_MAX_SOURCE_BYTES) {
        return NextResponse.json({ ok: false, error: "JS 文件过大，未建索引" }, { status: 400 });
      }
      const index = await buildJsIndex(file, new TextDecoder().decode(raw.buf));
      const written = await writeJsIndex(index);
      return NextResponse.json({ ok: true, jsIndex: true, path: written, index });
    }
    if (body.raw) {
      if (!body.path) {
        return NextResponse.json({ ok: false, error: "缺少 path" }, { status: 400 });
      }
      if (typeof body.base64 === "string") {
        const rel = await writeRawBase64File(body.path, body.base64);
        return NextResponse.json({ ok: true, raw: true, path: rel });
      }
      if (typeof body.content !== "string") {
        return NextResponse.json({ ok: false, error: "缺少 content/base64" }, { status: 400 });
      }
      const rel = await writeRawTextFile(body.path, body.content);
      return NextResponse.json({ ok: true, raw: true, path: rel });
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
