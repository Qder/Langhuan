import { describe, expect, it } from "vitest";
import {
  openCreateDocDialog,
  subscribeCreateDocDialog,
  type CreateDocDialogRequest,
} from "./createDocDialogBus";

describe("createDocDialogBus", () => {
  it("delivers a request to a mounted host", () => {
    const seen: CreateDocDialogRequest[] = [];
    const off = subscribeCreateDocDialog((r) => r && seen.push(r));
    try {
      openCreateDocDialog({ type: "md", defaultName: "新笔记" });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: "md", defaultName: "新笔记" });
    } finally {
      off();
    }
  });

  it("holds a request made with no host until the next host mounts (读码 → 藏书阁)", () => {
    // No host: the request must not be lost while IdeShell owns the screen.
    openCreateDocDialog({ type: "html", defaultName: "快照" });

    const seen: CreateDocDialogRequest[] = [];
    const off = subscribeCreateDocDialog((r) => r && seen.push(r));
    try {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: "html", defaultName: "快照" });
    } finally {
      off();
    }
  });

  it("a held request is delivered only once", () => {
    openCreateDocDialog({ type: "md", defaultName: "一次" });

    const first: CreateDocDialogRequest[] = [];
    subscribeCreateDocDialog((r) => r && first.push(r))();

    const second: CreateDocDialogRequest[] = [];
    const off = subscribeCreateDocDialog((r) => r && second.push(r));
    try {
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    } finally {
      off();
    }
  });
});
