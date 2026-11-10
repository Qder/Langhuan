import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeBackupFixture } from "./storage/backupTestFixtures";
import { assignBackupLearning, type BackupPayload } from "./storage/backup";
import { LEARNING_PATHS, parseLearningFile } from "./storage/learningData";
import {
  EXPLAIN_NETWORK_FAILURE_MESSAGE,
  EXPLAIN_OFFLINE_MESSAGE,
  explainTransportFailure,
} from "./ide/explainTimeout";
import {
  OFFLINE_LOCAL_ACTIONS,
  localStudyRequiresNetwork,
} from "./offlineLocalStudy";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => memory.get(key),
  set: async (key: string, value: unknown) => {
    memory.set(key, value);
  },
  del: async (key: string) => {
    memory.delete(key);
  },
  keys: async () => [...memory.keys()],
}));

import {
  loadSandboxProject,
  readSandboxFile,
  storeSandboxProject,
  type IdeSandboxProject,
} from "./ide/sandboxFs";

const bannedFetch = vi.fn(async () => {
  throw new TypeError("Failed to fetch");
});

beforeEach(() => {
  memory.clear();
  bannedFetch.mockClear();
  vi.stubGlobal("fetch", bannedFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline local study (fixture data, no network)", () => {
  it("declares local read / annotate / topic / imported-project paths as not requiring network", () => {
    for (const action of OFFLINE_LOCAL_ACTIONS) {
      expect(localStudyRequiresNetwork(action)).toBe(false);
    }
  });

  it("hydrates Step 3/4/7 learning files, topics, and a backup-restored library without calling fetch", () => {
    const fixture = completeBackupFixture();
    const topicsFile = parseLearningFile(
      LEARNING_PATHS.topics,
      JSON.stringify({
        format: "langhuan-topics",
        version: 1,
        topics: fixture.topics,
      })
    );
    const annotationsFile = parseLearningFile(
      LEARNING_PATHS.annotations,
      JSON.stringify({
        format: "langhuan-annotations",
        version: 1,
        annotations: fixture.annotations,
      })
    );
    expect(topicsFile.format).toBe("langhuan-topics");
    expect(annotationsFile.format).toBe("langhuan-annotations");

    const restored: BackupPayload = {
      ...fixture,
      annotations: [],
      topics: [],
    };
    assignBackupLearning(restored, topicsFile);
    assignBackupLearning(restored, annotationsFile);

    const topic = restored.topics?.find((t) => t.id === "topic-1");
    expect(topic).toBeTruthy();
    expect(topic?.noteIds).toContain("d1");
    const note = restored.documents.find((d) => d.id === "d1");
    expect(note?.content).toContain("study");
    expect(restored.annotations?.some((a) => a.id === "ann")).toBe(true);
    expect(restored.readingProgress?.["notes/a.md"]?.top).toBe(42);
    expect(bannedFetch).not.toHaveBeenCalled();
  });

  it("opens a mocked imported sandbox project without network", async () => {
    const project: IdeSandboxProject = {
      id: "sandbox:course",
      name: "course",
      pathLabel: "导入 zip · course.zip",
      sourceName: "course.zip",
      importedAt: 1,
      files: { "src/Main.java": "class Main { }" },
    };
    await storeSandboxProject(project);
    const loaded = await loadSandboxProject("sandbox:course");
    expect(loaded?.files["src/Main.java"]).toBe("class Main { }");
    expect(readSandboxFile(loaded!, "src/Main.java")).toBe("class Main { }");
    expect(bannedFetch).not.toHaveBeenCalled();
  });

  it("keeps notes, topics and the sandbox usable when 讲解 fails offline or over a dead network", async () => {
    const project: IdeSandboxProject = {
      id: "sandbox:course",
      name: "course",
      pathLabel: "导入 zip · course.zip",
      sourceName: "course.zip",
      importedAt: 2,
      files: { "a.ts": "export const ok = 1;" },
    };
    await storeSandboxProject(project);
    const snapshot = {
      documents: completeBackupFixture().documents,
      topics: completeBackupFixture().topics,
      sandboxId: project.id,
    };

    const offline = explainTransportFailure(new TypeError("Failed to fetch"), {
      userAborted: false,
      online: false,
    });
    const network = explainTransportFailure(new TypeError("Failed to fetch"), {
      userAborted: false,
      online: true,
    });
    expect(offline).toEqual({ kind: "error", message: EXPLAIN_OFFLINE_MESSAGE });
    expect(network).toEqual({
      kind: "error",
      message: EXPLAIN_NETWORK_FAILURE_MESSAGE,
    });
    expect(offline.kind === "error" && offline.message).toMatch(/讲解/);
    expect(offline.kind === "error" && offline.message).toMatch(/仍可/);

    // Explain UI would show the message; local study state is untouched.
    expect(snapshot.documents[0]?.id).toBe("d1");
    expect(snapshot.topics?.[0]?.title).toBe("入门");
    expect(await loadSandboxProject(snapshot.sandboxId)).toEqual(project);
    expect(bannedFetch).not.toHaveBeenCalled();
  });
});
