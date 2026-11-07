import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns";
import {
  buildMockExplainMarkdown,
  resolveExplainApiMessages,
  resolveExplainBaseUrl,
  resolveExplainModel,
  type IdeExplainFilePayload,
} from "@/lib/ide/explain";
import {
  EXPLAIN_REQUEST_TIMEOUT_MS,
  explainTimeoutMessage,
  isAbortLike,
} from "@/lib/ide/explainTimeout";

dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  question?: string;
  files?: IdeExplainFilePayload[];
  /** Path-only project file list (no bodies). */
  fileIndex?: string[];
  /** TS 拼好的整表 [system, …prior, current user]；缺省时服务端再拼。 */
  messages?: Array<{ role?: string; content?: string }>;
  locale?: string;
  /** Optional client-provided key (IDE settings); never logged. */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

function pickKey(body: Body): string {
  return (body.apiKey || process.env.OPENAI_API_KEY || "").trim();
}

function pickBase(body: Body): string {
  return resolveExplainBaseUrl(body.baseUrl || process.env.OPENAI_BASE_URL || "");
}

function pickModel(body: Body, base: string): string {
  return resolveExplainModel(body.model || process.env.OPENAI_MODEL || "", base);
}

function mockStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Chunk by paragraph so the UI can stream without waiting for the whole string.
  const parts = text.split(/(?<=\n\n)/);
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      // Pause between paragraphs so 生成中 chips stay clickable in mock.
      await new Promise((r) => setTimeout(r, 280));
      controller.enqueue(encoder.encode(parts[i]));
      i += 1;
    },
  });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const question = (body.question || "").trim() || "请讲解当前文件";
  const files = Array.isArray(body.files) ? body.files.slice(0, 4) : [];
  const fileIndex = Array.isArray(body.fileIndex)
    ? body.fileIndex
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .slice(0, 200)
    : [];
  const key = pickKey(body);
  const messages = resolveExplainApiMessages({
    question,
    files,
    fileIndex,
    messages: body.messages,
  });
  const prior = messages.filter((m) => m.role !== "system").slice(0, -1);

  if (!key) {
    const text = buildMockExplainMarkdown({ question, files, fileIndex, prior });
    return new Response(mockStream(text), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Langhuan-Explain": "mock",
      },
    });
  }

  const base = pickBase(body);
  const model = pickModel(body, base);

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.3,
      }),
      // 等首包用较短超时；整轮上限更长，避免生成中途被 75/180s 杀掉。
      signal: AbortSignal.timeout(EXPLAIN_REQUEST_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const status = upstream.status;
      const human =
        status === 401
          ? "API Key 无效或未授权（401）"
          : `模型请求失败（${status}）`;
      return NextResponse.json(
        { ok: false, error: human, detail: errText.slice(0, 400) },
        { status: 502 }
      );
    }

    // Translate OpenAI SSE → plain text stream of assistant deltas.
    const reader = upstream.body?.getReader();
    if (!reader) {
      return NextResponse.json({ ok: false, error: "上游无响应流" }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const piece = json.choices?.[0]?.delta?.content;
              if (piece) controller.enqueue(encoder.encode(piece));
            } catch {
              // ignore partial JSON
            }
          }
        }
      },
      cancel() {
        void reader.cancel();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Langhuan-Explain": "live",
      },
    });
  } catch (e) {
    if (isAbortLike(e)) {
      return NextResponse.json(
        { ok: false, error: explainTimeoutMessage(base) },
        { status: 504 }
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `网络失败：${message}` },
      { status: 502 }
    );
  }
}
