/** @vitest-environment node */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { set as idbSet } from "idb-keyval";
import { ensureBackupAdoption } from "./backupAdoption";
import { hydrateLearningState } from "./learningPersistence";
import {
  snapshotBackupLibrary,
  stageBackupLibrary,
  applyStagedBackup,
  readBackupRestoreState,
  readLearningFile,
  writeLearningFile,
} from "./contentFs";
import { payloadToBackupTree, payloadFromBackupTree } from "./backupTree";
import { completeBackupFixture, backupDoc } from "./backupTestFixtures";
import { adoptRestoredVersions } from "./versions";
import { STORE_KEY } from "./constants";
import { readScrollMemoryMap } from "../scrollMemory";
import { setLearningReadBlocked } from "./learningIO";
import { LEARNING_PATHS } from "./learningData";
import type { LanghuanState } from "../store/types";
const { db } = vi.hoisted(() => ({ db: new Map<string, unknown>() }));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (k: string) => db.get(k)),
  set: vi.fn(async (k: string, v: unknown) => {
    db.set(k, v);
  }),
  keys: vi.fn(async () => [...db.keys()]),
  del: vi.fn(),
}));
vi.mock("./backupApi", () => ({
  fetchBackupRestoreState: () => readBackupRestoreState(),
  fetchBackupSnapshot: () => snapshotBackupLibrary(),
}));
vi.mock("./contentApi", () => ({
  fetchLearningFile: (p: string) => readLearningFile(p),
  putLearningFile: (p: string, v: Parameters<typeof writeLearningFile>[1]) =>
    writeLearningFile(p, v),
}));
const cwd = process.cwd();
let home: string;
let root: string;
let values: Map<string, string>;
let state: LanghuanState;
const get = () => state;
const change = (patch: Partial<LanghuanState>) => {
  state = { ...state, ...patch };
};
async function prepareRestore() {
  const tree = payloadToBackupTree(completeBackupFixture());
  for (const f of tree.files) {
    const abs = path.join(root, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(f.base64, "base64"));
  }
  const snapshot = await snapshotBackupLibrary();
  const staged = await stageBackupLibrary(
    tree,
    "replace",
    snapshot.fingerprint,
  );
  return applyStagedBackup(staged.id);
}
beforeEach(async () => {
  db.clear();
  vi.mocked(idbSet).mockImplementation(async (k, v) => {
    db.set(String(k), v);
  });
  values = new Map();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  await adoptRestoredVersions({});
  for (const p of Object.values(LEARNING_PATHS))
    setLearningReadBlocked(p, false);
  home = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-adopt-"));
  process.chdir(home);
  root = path.join(home, "content");
  state = {
    documents: [backupDoc()],
    drafts: { d1: backupDoc().content },
    trash: [],
    annotations: [],
    quizDocs: [],
    savedSearches: [],
  } as unknown as LanghuanState;
  db.set(
    STORE_KEY,
    JSON.stringify({
      version: 9,
      state: {
        theme: "dark",
        annotations: [],
        quizDocs: [],
        savedSearches: [],
      },
    }),
  );
  db.set("langhuan-versions:old-only", [
    {
      id: "old",
      docId: "old-only",
      path: "old.md",
      content: "old-only",
      savedAt: 99,
    },
  ]);
  values.set(
    "lh.mdScroll",
    JSON.stringify({ "old.md": { top: 1, ratio: 1, savedAt: 99 } }),
  );
});
afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllGlobals();
  await fs.rm(home, { recursive: true, force: true });
});
describe("confirmed restore local adoption/relaunch", () => {
  it("adopts library learning data/assets while preserving device prefs and old keys", async () => {
    const applied = await prepareRestore();
    await ensureBackupAdoption(get, change);
    expect(state.annotations).toEqual(completeBackupFixture().annotations);
    expect(state.quizDocs).toEqual(completeBackupFixture().quizDocs);
    expect(readScrollMemoryMap()).toEqual(
      completeBackupFixture().readingProgress,
    );
    expect(db.has("langhuan-versions:old-only")).toBe(true);
    expect(db.get("langhuan-versions:old-only")).toEqual([]);
    expect(db.get("langhuan-versions:d1")).toEqual(
      completeBackupFixture().versions!.d1,
    );
    expect(db.get("langhuan-asset:image")).toBeInstanceOf(Blob);
    expect(JSON.parse(db.get(STORE_KEY) as string).state.theme).toBe("dark");
    expect(db.get("langhuan-backup-adopted-generation")).toBe(
      applied.generation,
    );
    expect(state.drafts).toEqual({});
    const rollback = db.get(
      `langhuan-backup-local-rollback:${applied.generation}`,
    ) as { memory: { drafts: Record<string, string> } };
    expect(rollback.memory.drafts.d1).toBe(backupDoc().content);
  });
  it("re-hydrates after simulated relaunch without resurrecting removed old-only history/progress", async () => {
    await prepareRestore();
    await ensureBackupAdoption(get, change);
    const adopted = JSON.parse(db.get(STORE_KEY) as string).state;
    state = {
      ...state,
      ...adopted,
      documents: payloadFromBackupTree(await snapshotBackupLibrary()).documents,
    };
    await hydrateLearningState(get, change);
    expect(state.annotations).toEqual(completeBackupFixture().annotations);
    expect(state.savedSearches).toEqual(completeBackupFixture().savedSearches);
    expect(readScrollMemoryMap()["old.md"]).toBeUndefined();
    const file = await readLearningFile(".langhuan/versions/old-only.json");
    expect(file).toBeNull();
    expect((await readLearningFile(".langhuan/versions/d1.json"))?.format).toBe(
      "langhuan-versions",
    );
  });
  it("IDB write failure leaves durable library untouched, no success marker, and adoption can retry", async () => {
    await prepareRestore();
    const before = await snapshotBackupLibrary();
    const old = db.get(STORE_KEY);
    vi.mocked(idbSet).mockImplementationOnce(async (k, v) => {
      db.set(String(k), v);
    });
    let fail = true;
    vi.mocked(idbSet).mockImplementation(async (k, v) => {
      if (k === STORE_KEY && fail) {
        fail = false;
        throw new Error("IDB full");
      }
      db.set(String(k), v);
    });
    await expect(ensureBackupAdoption(get, change)).rejects.toThrow("IDB full");
    expect(db.get(STORE_KEY)).toBe(old);
    expect(db.has("langhuan-backup-adopted-generation")).toBe(false);
    expect(await snapshotBackupLibrary()).toEqual(before);
    expect(state.annotations).toHaveLength(1);
    await ensureBackupAdoption(get, change);
    expect(db.has("langhuan-backup-adopted-generation")).toBe(true);
  });
  it("corrupt or missing restored learning files do not replace old stores with empties", async () => {
    await prepareRestore();
    const old = db.get(STORE_KEY);
    await fs.writeFile(
      path.join(root, ".langhuan/reading-progress.json"),
      "broken",
    );
    await expect(ensureBackupAdoption(get, change)).rejects.toThrow();
    expect(db.get(STORE_KEY)).toBe(old);
    expect(db.has("langhuan-backup-adopted-generation")).toBe(false);
    expect(
      await fs.readFile(
        path.join(root, ".langhuan/reading-progress.json"),
        "utf8",
      ),
    ).toBe("broken");
    await fs.unlink(path.join(root, ".langhuan/reading-progress.json"));
    await expect(ensureBackupAdoption(get, change)).rejects.toThrow("缺失");
    expect(db.get(STORE_KEY)).toBe(old);
  });
});
