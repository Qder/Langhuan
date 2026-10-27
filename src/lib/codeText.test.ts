import { describe, expect, it } from "vitest";
import { flattenCodeText, isMermaidLanguage, languageFromClassName } from "./codeText";

describe("languageFromClassName", () => {
  it("parses language-* tokens", () => {
    expect(languageFromClassName("language-ts")).toBe("ts");
    expect(languageFromClassName("hljs language-mermaid")).toBe("mermaid");
    expect(languageFromClassName("language-MERMAID")).toBe("mermaid");
    expect(languageFromClassName(undefined)).toBe("");
    expect(languageFromClassName("nope")).toBe("");
  });
});

describe("isMermaidLanguage", () => {
  it("detects mermaid fences", () => {
    expect(isMermaidLanguage("language-mermaid")).toBe(true);
    expect(isMermaidLanguage("language-ts")).toBe(false);
  });
});

describe("flattenCodeText", () => {
  it("joins strings and nested props.children", () => {
    expect(flattenCodeText("flowchart TD\n  A-->B\n")).toBe("flowchart TD\n  A-->B\n");
    expect(flattenCodeText(["a", "b"])).toBe("ab");
    expect(
      flattenCodeText({
        props: { children: ["graph ", { props: { children: "LR" } }, "\n"] },
      })
    ).toBe("graph LR\n");
    expect(flattenCodeText(null)).toBe("");
  });
});
