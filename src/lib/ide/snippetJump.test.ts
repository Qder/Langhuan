import { describe, expect, it } from "vitest";
import { locateExplainFence } from "./snippetJump";
import type { ExplainFence } from "./snippetLocate";

function fence(partial: Partial<ExplainFence> & { body: string }): ExplainFence {
  return {
    lang: "java",
    info: "",
    index: 0,
    endIndex: 0,
    ...partial,
  };
}

describe("locateExplainFence", () => {
  it("uses verified path:line instead of a later duplicate", async () => {
    const body = "void run() {}";
    const content = `${body}\nkeep\n${body}\n`;
    const r = await locateExplainFence({
      fence: fence({
        body,
        path: "src/A.java",
        line: 3,
        endLine: 3,
      }),
      snapshot: [{ path: "src/A.java", content, startLine: 1 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.line).toBe(3);
      expect(r.hits).toHaveLength(1);
    }
  });

  it("falls back to substring when cited lines do not contain the snippet", async () => {
    const r = await locateExplainFence({
      fence: fence({
        body: "public class A {",
        path: "src/A.java",
        line: 1,
        endLine: 1,
      }),
      snapshot: [
        {
          path: "src/A.java",
          content: "package demo;\n\npublic class A {\n  void run() {}\n}\n",
          startLine: 1,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.line).toBe(3);
  });

  it("on miss, re-reads full file from disk instead of truncated snapshot", async () => {
    const full = Array.from({ length: 40 }, (_, i) => `L${i + 1}`).join("\n");
    const truncated = full.split("\n").slice(0, 5).join("\n");
    const snippet = "L30";
    const r = await locateExplainFence({
      fence: fence({ body: `keep ${snippet} token` }),
      snapshot: [
        {
          path: "src/A.java",
          content: truncated,
          startLine: 1,
        },
      ],
      readFile: async (path) => {
        expect(path).toBe("src/A.java");
        return full.replace("L30", "keep L30 token");
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe("src/A.java");
      expect(r.line).toBe(30);
    }
  });

  it("does not invent extra project files — only snapshot/tab/fence paths", async () => {
    const asked: string[] = [];
    const r = await locateExplainFence({
      fence: fence({ body: "function uniqueNeedle() { return 1; }" }),
      snapshot: [{ path: "src/a.ts", content: "nope", startLine: 1 }],
      readFile: async (path) => {
        asked.push(path);
        return "still nope";
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("miss");
    expect(asked).toEqual(["src/a.ts"]);
  });
});
