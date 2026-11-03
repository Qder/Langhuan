import { NextRequest, NextResponse } from "next/server";
import {
  assembleExplainUserContent,
  buildMockExplainMarkdown,
  IDE_EXPLAIN_SYSTEM_PROMPT,
  type IdeExplainFilePayload,
} from "@/lib/ide/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  question?: string;
  files?: IdeExplainFilePayload[];
  /** Path-only project file list (no bodies). */
  fileIndex?: string[];
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
  return (
    (body.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim() ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
}

function pickModel(body: Body): string {
  return (body.model || process.env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
}

function mockStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Chunk by paragraph so the UI can stream without waiting for the whole string.
  const parts = text.split(/(?<=\n\n)/);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
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

  if (!key) {
    const text = buildMockExplainMarkdown({ question, files, fileIndex });
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
  const model = pickModel(body);
  const messages = [
    { role: "system", content: IDE_EXPLAIN_SYSTEM_PROMPT },
    {
      role: "user",
      content: assembleExplainUserContent(question, files, fileIndex),
    },
  ];

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
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `网络失败：${message}` },
      { status: 502 }
    );
  }
}
