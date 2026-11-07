import { describe, expect, it } from "vitest";
import {
  assembleExplainChatMessages,
  assembleExplainUserContent,
  buildExplainFilePayloads,
  buildMockExplainMarkdown,
  collectScannedFileIndex,
  mockExplainHasCitationTo,
  normalizeExplainBaseUrl,
  normalizeExplainFilePayloads,
  planExplainSelectionRequest,
  javaImportToSuffix,
  listNearbyImports,
  planNearbyExplainFiles,
  planExplainFolderFiles,
  rankExplainFolderPaths,
  resolveExplainApiMessages,
  resolveExplainBaseUrl,
  resolveExplainModel,
  selectExplainPriorMessages,
  DEEPSEEK_EXPLAIN_BASE_URL,
  DEEPSEEK_EXPLAIN_MODEL,
  DEFAULT_EXPLAIN_BASE_URL,
  DEFAULT_EXPLAIN_MODEL,
  IDE_EXPLAIN_MAX_FULL_LINES,
  IDE_EXPLAIN_MODEL_PRIOR_MAX,
  IDE_EXPLAIN_PRIOR_CHARS_MAX,
  IDE_EXPLAIN_SYSTEM_PROMPT,
} from "./explain";
import { parseIdeCitations } from "./citations";
import type { IdeFsEntry } from "./ideFs";

describe("buildExplainFilePayloads", () => {
  it("sends whole small file", () => {
    const content = Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: false,
    });
    expect(files).toEqual([{ path: "src/A.java", content, startLine: 1 }]);
  });

  it("truncates large file without selection", () => {
    const content = Array.from(
      { length: IDE_EXPLAIN_MAX_FULL_LINES + 50 },
      (_, i) => `L${i + 1}`
    ).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: false,
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.startLine).toBe(1);
    expect(files[0]!.content.split("\n").length).toBeLessThan(
      IDE_EXPLAIN_MAX_FULL_LINES
    );
    expect(files[0]!.content).toContain("已截断");
  });

  it("sends selection±pad for large file", () => {
    const content = Array.from({ length: 500 }, (_, i) => `L${i + 1}`).join("\n");
    const files = buildExplainFilePayloads({
      path: "src/A.java",
      content,
      includeFile: true,
      includeSelection: true,
      selection: { fromLine: 200, toLine: 205 },
    });
    expect(files[0]!.startLine).toBe(120);
    expect(files[0]!.content.startsWith("L120")).toBe(true);
  });
});

describe("collectScannedFileIndex / assembleExplainUserContent", () => {
  it("assembles fileIndex paths without bodies", () => {
    const children: Record<string, IdeFsEntry[]> = {
      "": [
        { name: "src", path: "src", kind: "directory" },
        { name: "README.md", path: "README.md", kind: "file" },
      ],
      src: [
        { name: "A.java", path: "src/A.java", kind: "file" },
        { name: "B.java", path: "src/B.java", kind: "file" },
        { name: "node_modules", path: "src/node_modules", kind: "directory" },
      ],
      "src/node_modules": [
        { name: "x.js", path: "src/node_modules/x.js", kind: "file" },
      ],
    };
    const index = collectScannedFileIndex(children);
    expect(index).toEqual(["README.md", "src/A.java", "src/B.java"]);
    expect(index).not.toContain("src/node_modules/x.js");

    const body = assembleExplainUserContent(
      "这个类和哪个文件有关",
      [{ path: "src/A.java", content: "class A {}", startLine: 1 }],
      index
    );
    expect(body).toContain("工程已扫描文件路径");
    expect(body).toContain("- src/A.java");
    expect(body).toContain("- src/B.java");
    expect(body).toContain("class A {}");
    // index entries are paths only — no accidental dump of ignored bodies
    expect(body).not.toContain("node_modules/x.js");
  });
});

describe("buildMockExplainMarkdown", () => {
  it("cites the real current file path with a line", () => {
    const md = buildMockExplainMarkdown({
      question: "这个类干什么",
      files: [
        {
          path: "src/A.java",
          content: "package demo;\n\npublic class A {\n  void run() {}\n}\n",
          startLine: 1,
        },
      ],
    });
    expect(mockExplainHasCitationTo(md, "src/A.java")).toBe(true);
    const hits = parseIdeCitations(md);
    expect(hits.some((h) => h.path === "src/A.java" && h.line != null)).toBe(
      true
    );
  });

  it("cites a second index file at line 1 when present", () => {
    const md = buildMockExplainMarkdown({
      question: "这个类和哪个文件有关",
      files: [
        {
          path: "src/A.java",
          content: "public class A {}\n",
          startLine: 1,
        },
      ],
      fileIndex: ["src/A.java", "src/B.java"],
    });
    const hits = parseIdeCitations(md);
    expect(hits.some((h) => h.path === "src/A.java")).toBe(true);
    expect(
      hits.some((h) => h.path === "src/B.java" && h.line === 1)
    ).toBe(true);
    expect(mockExplainHasCitationTo(md, "src/B.java")).toBe(true);
  });
});


describe("planExplainSelectionRequest / selection payloads", () => {
  it("builds padded payload from a selection", () => {
    const content = Array.from({ length: 500 }, (_, i) => `L${i + 1}`).join("\n");
    const selection = {
      path: "src/A.java",
      fromLine: 200,
      toLine: 205,
      text: "L200\nL201",
    };
    const planned = planExplainSelectionRequest(selection);
    expect(planned).not.toBeNull();
    expect(planned!.question).toBe("解释当前选区");
    const files = buildExplainFilePayloads({
      path: selection.path,
      content,
      includeFile: planned!.includeFile,
      includeSelection: planned!.includeSelection,
      selection,
    });
    expect(files[0]!.startLine).toBe(120);
    expect(files[0]!.content).toContain("L200");
  });

  it("is a no-op without selection", () => {
    expect(planExplainSelectionRequest(null)).toBeNull();
    expect(
      planExplainSelectionRequest({
        path: "src/A.java",
        fromLine: 1,
        toLine: 1,
        text: "",
      })
    ).toBeNull();
  });
});

describe("javaImportToSuffix", () => {
  it("maps package type to .java suffix", () => {
    expect(javaImportToSuffix("com.demo.Foo")).toBe("com/demo/Foo.java");
  });

  it("skips JDK packages and star imports", () => {
    expect(javaImportToSuffix("java.util.List")).toBeNull();
    expect(javaImportToSuffix("javax.swing.JFrame")).toBeNull();
    expect(javaImportToSuffix("jakarta.servlet.Servlet")).toBeNull();
    expect(javaImportToSuffix("com.foo.*")).toBeNull();
  });
});

describe("listNearbyImports / planNearbyExplainFiles", () => {
  it("plans only relative ./B.java and skips java.util.List", () => {
    const content = [
      "import java.util.List;",
      "import \"./B.java\";",
      "import \"./C.java\";",
      "",
      "class A { List x; }",
    ].join("\n");
    expect(listNearbyImports("src/A.java", content)).toEqual([
      "src/B.java",
      "src/C.java",
    ]);
  });

  it("truncates to 3 relative imports", () => {
    const hits = listNearbyImports(
      "pkg/Main.ts",
      ["import \"./a.ts\";", "import \"./b.ts\";", "import \"./c.ts\";", "import \"./d.ts\";"].join("\n")
    );
    expect(hits).toEqual(["pkg/a.ts", "pkg/b.ts", "pkg/c.ts"]);
  });

  it("plans unique Java package import from fileIndex", () => {
    const content = ["import com.demo.Foo;", "class A {}"].join("\n");
    const index = ["src/main/java/com/demo/Foo.java"];
    expect(listNearbyImports("src/main/java/com/campus/A.java", content, index)).toEqual([
      "src/main/java/com/demo/Foo.java",
    ]);
  });

  it("does not collect java.util.List even when List.java exists", () => {
    const content = "import java.util.List;\nclass A {}";
    expect(
      listNearbyImports("src/A.java", content, ["src/List.java", "java/util/List.java"])
    ).toEqual([]);
  });

  it("skips Java package import when two Foo.java paths match", () => {
    const content = "import com.demo.Foo;\nclass A {}";
    expect(
      listNearbyImports("src/A.java", content, [
        "a/com/demo/Foo.java",
        "b/com/demo/Foo.java",
      ])
    ).toEqual([]);
  });

  it("does not collect star imports", () => {
    const content = "import com.foo.*;\nclass A {}";
    expect(
      listNearbyImports("src/A.java", content, ["src/main/java/com/foo/Bar.java"])
    ).toEqual([]);
  });

  it("fills remaining slots with Java after relative imports", () => {
    const content = [
      'import "./B.java";',
      "import com.demo.Foo;",
      "import java.util.List;",
    ].join("\n");
    expect(
      listNearbyImports("src/A.java", content, [
        "src/main/java/com/demo/Foo.java",
      ])
    ).toEqual(["src/B.java", "src/main/java/com/demo/Foo.java"]);
  });

  it("planNearbyExplainFiles reads B and reports skipped", () => {
    const content = 'import "./B.java";\nimport "./Missing.java";\nimport java.util.List;';
    const { files, skipped } = planNearbyExplainFiles({
      path: "src/A.java",
      content,
      enabled: true,
      alreadyPaths: ["src/A.java"],
      readContent: (p) => (p === "src/B.java" ? "class B {}" : null),
    });
    expect(files.map((f) => f.path)).toEqual(["src/B.java"]);
    expect(skipped).toEqual(["src/Missing.java"]);
  });

  it("planNearbyExplainFiles includes unique Java package neighbor", () => {
    const content = "import com.demo.Foo;\nclass A {}";
    const { files, skipped } = planNearbyExplainFiles({
      path: "src/A.java",
      content,
      enabled: true,
      alreadyPaths: ["src/A.java"],
      fileIndex: ["src/main/java/com/demo/Foo.java"],
      readContent: (p) =>
        p === "src/main/java/com/demo/Foo.java" ? "package com.demo;\nclass Foo {}" : null,
    });
    expect(files.map((f) => f.path)).toEqual(["src/main/java/com/demo/Foo.java"]);
    expect(skipped).toEqual([]);
  });
});

describe("assembleExplainChatMessages · 多轮", () => {
  const files = [{ path: "src/A.java", content: "class A { /* 注解 */ }", startLine: 1 }];

  it("第二问 messages 含第一问与第一答，且 prior 不含 files 正文", () => {
    const history = [
      { role: "user" as const, content: "这个文件在干什么" },
      { role: "assistant" as const, content: "入口是注解 @Foo" },
    ];
    const messages = assembleExplainChatMessages({
      question: "刚才说的注解是什么意思",
      files,
      prior: history,
    });
    expect(messages[0]).toEqual({
      role: "system",
      content: IDE_EXPLAIN_SYSTEM_PROMPT,
    });
    expect(messages[1]).toEqual(history[0]);
    expect(messages[2]).toEqual(history[1]);
    expect(messages[3]?.role).toBe("user");
    expect(messages[3]?.content).toContain("刚才说的注解是什么意思");
    expect(messages[3]?.content).toContain("class A { /* 注解 */ }");
    const priorBlob = JSON.stringify(messages.slice(1, -1));
    expect(priorBlob).toContain("这个文件在干什么");
    expect(priorBlob).not.toContain("class A { /* 注解 */ }");
  });

  it("清空后 prior 为空，请求不再带旧 turn", () => {
    expect(selectExplainPriorMessages([])).toEqual([]);
    const messages = assembleExplainChatMessages({
      question: "这个文件在干什么",
      files,
      prior: [],
    });
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages)).not.toContain("入口是注解");
  });

  it("跳过空助手气泡，截到 MODEL_PRIOR_MAX，过长对话截断", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn-${i} ${"x".repeat(IDE_EXPLAIN_PRIOR_CHARS_MAX + 10)}`,
    }));
    const selected = selectExplainPriorMessages([
      ...many,
      { role: "assistant", content: "   " },
    ]);
    expect(selected.length).toBeLessThanOrEqual(IDE_EXPLAIN_MODEL_PRIOR_MAX);
    expect(selected[0]?.role).toBe("user");
    expect(selected.every((m) => m.content.includes("…"))).toBe(true);
    expect(selected.every((m) => m.content.length <= IDE_EXPLAIN_PRIOR_CHARS_MAX + 2)).toBe(
      true
    );
  });

  it("resolveExplainApiMessages 优先用客户端整表", () => {
    const fromClient = resolveExplainApiMessages({
      question: "忽略我",
      files,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "这个文件在干什么" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "刚才说的注解是什么意思" },
      ],
    });
    expect(JSON.stringify(fromClient)).toContain("这个文件在干什么");
    expect(JSON.stringify(fromClient)).toContain("刚才说的注解是什么意思");
    expect(fromClient[0]?.content).toBe("sys");
  });

  it("mock 第二问仍可读并提到上一问", () => {
    const text = buildMockExplainMarkdown({
      question: "刚才说的注解是什么意思",
      files,
      prior: [
        { role: "user", content: "这个文件在干什么" },
        { role: "assistant", content: "入口是注解" },
      ],
    });
    expect(text).toContain("刚才说的注解是什么意思");
    expect(text).toContain("这个文件在干什么");
  });
});

describe("planExplainFolderFiles / rankExplainFolderPaths", () => {
  it("ranks README and build files ahead of deep sources", () => {
    const ranked = rankExplainFolderPaths([
      "src/deep/nested/Foo.java",
      "logo.png",
      "README.md",
      "pom.xml",
    ]);
    expect(ranked[0]).toBe("README.md");
    expect(ranked[1]).toBe("pom.xml");
    expect(ranked).toContain("src/deep/nested/Foo.java");
    expect(ranked).not.toContain("logo.png");
  });

  it("attaches capped bodies and skips already-sent paths", () => {
    const bodies: Record<string, string> = {
      "README.md": "# demo",
      "pom.xml": "<project />",
      "src/A.java": "class A {}",
      "src/B.java": "class B {}",
    };
    const { files, omitted } = planExplainFolderFiles({
      enabled: true,
      fileIndex: Object.keys(bodies),
      alreadyPaths: ["src/A.java"],
      maxFiles: 2,
      maxChars: 48_000,
      readContent: (p) => bodies[p] ?? null,
    });
    expect(files.map((f) => f.path)).toEqual(["README.md", "pom.xml"]);
    expect(files.some((f) => f.path === "src/A.java")).toBe(false);
    expect(omitted).toBeGreaterThan(0);
  });

  it("stops when the char budget is exhausted", () => {
    const { files, omitted } = planExplainFolderFiles({
      enabled: true,
      fileIndex: ["README.md", "src/A.java"],
      maxFiles: 16,
      maxChars: 20,
      readContent: (p) => (p === "README.md" ? "x".repeat(50) : "class A {}"),
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("README.md");
    expect(files[0]!.content).toContain("工程正文已达上限");
    expect(omitted).toBe(1);
  });

  it("is a no-op when disabled", () => {
    expect(
      planExplainFolderFiles({
        enabled: false,
        fileIndex: ["README.md"],
        readContent: () => "# hi",
      })
    ).toEqual({ files: [], skipped: [], omitted: 0 });
  });
});

describe("normalizeExplainBaseUrl / resolveExplainModel", () => {
  it("DeepSeek 官方 host 不加 /v1，去掉误贴的 chat/completions", () => {
    expect(normalizeExplainBaseUrl("https://api.deepseek.com")).toBe(
      DEEPSEEK_EXPLAIN_BASE_URL
    );
    expect(
      normalizeExplainBaseUrl("https://api.deepseek.com/chat/completions")
    ).toBe(DEEPSEEK_EXPLAIN_BASE_URL);
    expect(
      normalizeExplainBaseUrl("https://api.deepseek.com/v1/chat/completions")
    ).toBe("https://api.deepseek.com/v1");
    expect(resolveExplainBaseUrl("")).toBe(DEEPSEEK_EXPLAIN_BASE_URL);
  });

  it("DeepSeek 端点留空模型用 deepseek-flash", () => {
    expect(resolveExplainModel("", DEEPSEEK_EXPLAIN_BASE_URL)).toBe(
      DEEPSEEK_EXPLAIN_MODEL
    );
    expect(resolveExplainModel("", DEFAULT_EXPLAIN_BASE_URL)).toBe(
      DEFAULT_EXPLAIN_MODEL
    );
    expect(resolveExplainModel("deepseek-v4-pro", DEEPSEEK_EXPLAIN_BASE_URL)).toBe(
      "deepseek-v4-pro"
    );
  });
});

describe("normalizeExplainFilePayloads", () => {
  it("keeps path/content/startLine and drops junk", () => {
    expect(
      normalizeExplainFilePayloads([
        { path: "./src/A.java", content: "class A {}", startLine: 4 },
        { path: "", content: "x" },
        null,
        { path: "src/B.java" },
      ])
    ).toEqual([
      { path: "src/A.java", content: "class A {}", startLine: 4 },
      { path: "src/B.java", content: "", startLine: 1 },
    ]);
  });
});
