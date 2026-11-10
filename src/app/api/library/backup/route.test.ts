/** @vitest-environment node */
import { beforeEach, afterEach, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { writeTextDoc, snapshotBackupLibrary } from "@/lib/storage/contentFs";
import { payloadToBackupTree } from "@/lib/storage/backupTree";
import { completeBackupFixture } from "@/lib/storage/backupTestFixtures";
const cwd = process.cwd();
let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-backup-api-"));
  process.chdir(home);
  await writeTextDoc({
    id: "old",
    path: "old.md",
    content: "old unique content",
  });
});
afterEach(async () => {
  process.chdir(cwd);
  await fs.rm(home, { recursive: true, force: true });
});
const request = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/library/backup", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
it("previews a read-only snapshot, stages independently, and only applies after a separate request", async () => {
  const before = await snapshotBackupLibrary();
  const preview = await request({ action: "snapshot" });
  expect(preview.headers.get("cache-control")).toBe("no-store");
  expect((await preview.json()).fingerprint).toBe(before.fingerprint);
  const stageResponse = await request({
    action: "stage",
    tree: payloadToBackupTree(completeBackupFixture()),
    mode: "replace",
    expectedFingerprint: before.fingerprint,
  });
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();
  expect(await snapshotBackupLibrary()).toEqual(before);
  const applied = await request({ action: "apply", id: stage.id });
  expect(applied.status).toBe(200);
  const result = await applied.json();
  expect(await fs.readFile(path.join(result.archive, "old.md"), "utf8")).toBe(
    "old unique content",
  );
  expect((await request({ action: "state" })).status).toBe(200);
});
it("propagates stale preview, invalid IDs, invalid mode and corrupt ZIP errors without mutating live files", async () => {
  const before = await snapshotBackupLibrary();
  for (const q of [
    {
      action: "stage",
      tree: payloadToBackupTree(completeBackupFixture()),
      mode: "replace",
      expectedFingerprint: "stale",
    },
    { action: "apply", id: "../bad" },
    { action: "stage", mode: "unknown" },
    { action: "save-auto", keep: 1, base64: "UEtiYWQ=" },
  ]) {
    const result = await request(q);
    expect(result.status).toBe(400);
    expect((await result.json()).error).toBeTruthy();
  }
  expect(await snapshotBackupLibrary()).toEqual(before);
});
