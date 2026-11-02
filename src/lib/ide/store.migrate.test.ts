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
  });
});
