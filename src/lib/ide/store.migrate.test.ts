import { describe, expect, it } from "vitest";
import {
  IDE_STORE_PERSIST_VERSION,
  migrateIdePersistedState,
} from "./idePersist";

describe("migrateIdePersistedState", () => {
  it("upgrades v1 recent+explorerOpen blob without wiping recent", () => {
    const out = migrateIdePersistedState(
      {
        recent: [
          {
            id: "proj-a",
            name: "Demo",
            pathLabel: "/tmp/Demo",
            lastOpenedAt: 42,
          },
        ],
        explorerOpen: false,
      },
      1
    );
    expect(out.recent).toEqual([
      {
        id: "proj-a",
        name: "Demo",
        pathLabel: "/tmp/Demo",
        lastOpenedAt: 42,
      },
    ]);
    expect(out.explorerOpen).toBe(false);
    expect(out.explainOpen).toBe(false);
    expect(out.explainBySession).toEqual({});
    expect(out.explainThreadsBySession).toEqual({});
    expect(out.explainActiveThreadIdBySession).toEqual({});
    expect(out.recentFiles).toEqual([]);
    expect(out.explainSettings).toEqual({
      apiKey: "",
      baseUrl: "",
      model: "",
    });
  });

  it("keeps explain fields when already present (v2 shape)", () => {
    const out = migrateIdePersistedState(
      {
        recent: [],
        explorerOpen: true,
        explainOpen: true,
        explainBySession: {
          sid: [
            {
              id: "m1",
              role: "user",
              content: "讲一下",
              createdAt: 1,
            },
          ],
        },
        explainSettings: {
          apiKey: "sk-test",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "local",
        },
      },
      IDE_STORE_PERSIST_VERSION
    );
    expect(out.explainOpen).toBe(true);
    expect(out.explainBySession.sid?.[0]?.content).toBe("讲一下");
    expect(out.explainThreadsBySession.sid).toHaveLength(1);
    expect(out.explainThreadsBySession.sid?.[0]?.messages[0]?.content).toBe(
      "讲一下"
    );
    expect(out.explainActiveThreadIdBySession.sid).toBe(
      out.explainThreadsBySession.sid?.[0]?.id
    );
    expect(out.explainSettings.apiKey).toBe("sk-test");
    expect(out.explainSettings.baseUrl).toContain("11434");
    expect(out.explainSettings.model).toBe("local");
  });

  it("tolerates null/garbage and does not invent ephemeral tabs/reveal", () => {
    const out = migrateIdePersistedState(null, 0);
    expect(out.recent).toEqual([]);
    expect(out.explorerOpen).toBe(true);
    expect(out).not.toHaveProperty("pendingReveal");
    expect(out).not.toHaveProperty("tabs");
    expect(out).not.toHaveProperty("session");

    const messy = migrateIdePersistedState(
      {
        recent: [{ id: 1 }, { id: "ok", name: "Ok", lastOpenedAt: "x" }],
        explainSettings: "nope",
        explainBySession: [],
      },
      1
    );
    expect(messy.recent).toEqual([
      { id: "ok", name: "Ok", pathLabel: "Ok", lastOpenedAt: 0 },
    ]);
    expect(messy.explainSettings).toEqual({
      apiKey: "",
      baseUrl: "",
      model: "",
    });
    expect(messy.explainBySession).toEqual({});
    expect(messy.explainThreadsBySession).toEqual({});
  });

  it("keeps explain file snapshots used for fence locate", () => {    const out = migrateIdePersistedState(
      {
        recent: [],
        explorerOpen: true,
        explainOpen: false,
        explainBySession: {
          sid: [
            {
              id: "a1",
              role: "assistant",
              content: "见代码",
              createdAt: 2,
              files: [
                {
                  path: "src/A.java",
                  content: "class A {}",
                  startLine: 1,
                },
              ],
            },
          ],
        },
        explainSettings: { apiKey: "", baseUrl: "", model: "" },
      },
      IDE_STORE_PERSIST_VERSION
    );
    expect(out.explainBySession.sid?.[0]?.files).toEqual([
      { path: "src/A.java", content: "class A {}", startLine: 1 },
    ]);
    expect(out.explainThreadsBySession.sid?.[0]?.messages[0]?.files).toEqual([
      { path: "src/A.java", content: "class A {}", startLine: 1 },
    ]);
  });

  it("v6 keeps multiple threads and does not flatten them", () => {
    const out = migrateIdePersistedState(
      {
        recent: [],
        explainThreadsBySession: {
          sid: [
            {
              id: "t1",
              title: "第一段",
              updatedAt: 1,
              messages: [
                { id: "u1", role: "user", content: "第一段", createdAt: 1 },
              ],
            },
            {
              id: "t2",
              title: "第二段",
              updatedAt: 2,
              messages: [
                { id: "u2", role: "user", content: "第二段", createdAt: 2 },
              ],
            },
          ],
        },
        explainActiveThreadIdBySession: { sid: "t2" },
      },
      5
    );
    expect(out.explainThreadsBySession.sid?.map((t) => t.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(out.explainActiveThreadIdBySession.sid).toBe("t2");
    expect(out.explainBySession.sid?.[0]?.content).toBe("第二段");
  });

  it("keeps v3 recent files and drops garbage / duplicates", () => {    const out = migrateIdePersistedState(
      {
        recent: [],
        recentFiles: [
          { sessionId: "s1", projectName: "demo", path: "src/a.ts", openedAt: 5 },
          { sessionId: "s1", projectName: "demo", path: "src/a.ts", openedAt: 9 },
          { sessionId: "s1", path: "" },
          { sessionId: "s2", projectName: "other", path: "B.java", openedAt: 3 },
          "nope",
        ],
      },
      2
    );
    expect(out.recentFiles.map((f) => f.path)).toEqual(["src/a.ts", "B.java"]);
    // Sorted by openedAt desc, so the newest copy (9) wins the dedupe.
    expect(out.recentFiles[0]!.openedAt).toBe(9);
  });

  it("v5 keeps the outline rail open state and defaults it off", () => {
    const on = migrateIdePersistedState({ recent: [], outlineOpen: true }, 4);
    expect(on.outlineOpen).toBe(true);

    const legacy = migrateIdePersistedState({ recent: [], explorerOpen: false }, 3);
    expect(legacy.outlineOpen).toBe(false);
    expect(legacy.explorerOpen).toBe(false);

    const junk = migrateIdePersistedState({ outlineOpen: "yes" }, 4);
    expect(junk.outlineOpen).toBe(false);
  });

  it("v4 keeps a pending ide link so a reload still knows where to jump", () => {
    const out = migrateIdePersistedState(
      { recent: [], pendingIdeLink: { path: "src/App.tsx", line: 10 } },
      3
    );
    expect(out.pendingIdeLink).toEqual({ path: "src/App.tsx", line: 10 });
  });

  it("v4 defaults to no pending link for older blobs", () => {
    expect(migrateIdePersistedState({ recent: [] }, 0).pendingIdeLink).toBeNull();
    expect(
      migrateIdePersistedState({ recent: [], pendingIdeLink: { path: "" } }, 3)
        .pendingIdeLink
    ).toBeNull();
  });
});
