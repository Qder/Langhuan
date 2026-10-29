import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetScrollBusForTests,
  publishScrollBus,
  subscribeScrollSync,
} from "./scrollBus";

describe("scrollBus", () => {
  beforeEach(() => {
    __resetScrollBusForTests();
  });

  it("delivers events to subscribers", () => {
    const seen: unknown[] = [];
    const unsub = subscribeScrollSync((ev) => seen.push(ev));
    publishScrollBus({
      docId: "d1",
      from: "preview",
      sourceOffset: 42,
      nonce: 1,
    });
    expect(seen).toEqual([
      { docId: "d1", from: "preview", sourceOffset: 42, nonce: 1 },
    ]);
    unsub();
    publishScrollBus({
      docId: "d1",
      from: "editor",
      sourceOffset: 99,
      nonce: 2,
    });
    expect(seen).toHaveLength(1);
  });
});
