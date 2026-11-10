import { describe, expect, it } from "vitest";
import {
  enrichExplainCitations,
  primarySelectionCitation,
} from "./enrichExplainCitations";

const file = {
  path: "src/add.ts",
  content: "line1\nexport function add(a: number, b: number) {\n  return a + b;\n}\n",
};

describe("enrichExplainCitations", () => {
  it("fills snapshot and projectId from the live selection", () => {
    const out = enrichExplainCitations(
      [{ path: "src/add.ts", line: 2, endLine: 4 }],
      {
        projectId: "proj-demo",
        selection: {
          path: "src/add.ts",
          fromLine: 2,
          toLine: 4,
          text: "export function add(a: number, b: number) {\n  return a + b;\n}",
        },
      }
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      path: "src/add.ts",
      line: 2,
      endLine: 4,
      projectId: "proj-demo",
      snapshot:
        "export function add(a: number, b: number) {\n  return a + b;\n}",
    });
  });

  it("slices an open file when the citation is not the current selection", () => {
    const out = enrichExplainCitations([{ path: "src/add.ts", line: 2, endLine: 3 }], {
      projectId: "proj-demo",
      files: [file],
    });
    expect(out[0]!.snapshot).toBe(
      "export function add(a: number, b: number) {\n  return a + b;"
    );
    expect(out[0]!.projectId).toBe("proj-demo");
  });
});

describe("primarySelectionCitation", () => {
  it("builds a citation from the selection when the model cited nothing", () => {
    const cite = primarySelectionCitation({
      projectId: "proj-demo",
      sourcePath: "src/add.ts",
      selection: {
        path: "src/add.ts",
        fromLine: 2,
        toLine: 4,
        text: "export function add() {}",
      },
    });
    expect(cite).toMatchObject({
      path: "src/add.ts",
      line: 2,
      endLine: 4,
      snapshot: "export function add() {}",
      projectId: "proj-demo",
    });
  });

  it("returns null without a selection snapshot", () => {
    expect(
      primarySelectionCitation({ projectId: "proj-demo", sourcePath: "src/add.ts" })
    ).toBeNull();
  });
});
