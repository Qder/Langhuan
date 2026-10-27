import { describe, expect, it } from "vitest";
import {
  applySlashInsert,
  filterSlashCommands,
  matchSlashCommand,
  SLASH_COMMANDS,
} from "./slashCommands";

describe("matchSlashCommand", () => {
  it("matches at line start", () => {
    const text = "hello\n/he";
    const m = matchSlashCommand(text, text.length);
    expect(m).not.toBeNull();
    expect(m!.query).toBe("he");
    expect(m!.items.some((c) => c.id === "h1" || c.id === "h2")).toBe(true);
  });

  it("ignores mid-line slash", () => {
    expect(matchSlashCommand("a /b", 4)).toBeNull();
  });

  it("allows leading indent", () => {
    const text = "  /wi";
    const m = matchSlashCommand(text, text.length);
    expect(m?.query).toBe("wi");
    expect(m?.items.some((c) => c.id === "wikilink")).toBe(true);
  });
});

describe("applySlashInsert", () => {
  it("replaces trigger and places caret", () => {
    const text = "/h1";
    const m = matchSlashCommand(text, text.length)!;
    const cmd = SLASH_COMMANDS.find((c) => c.id === "h1")!;
    const r = applySlashInsert(text, m, cmd);
    expect(r.text).toBe("# ");
    expect(r.caret).toBe(2);
  });
});

describe("filterSlashCommands", () => {
  it("filters by chinese keyword", () => {
    expect(filterSlashCommands("双链").some((c) => c.id === "wikilink")).toBe(true);
    expect(filterSlashCommands("nosuchthingatall")).toHaveLength(0);
  });
});
