import { describe, expect, it } from "vitest";
import { mergePersistedState } from "./persistMerge";
import {
  DEFAULT_READING_PREFS,
  normalizeReadingPrefs,
  type ReadingPrefs,
} from "../readingPrefs";

type State = { readingPrefs: ReadingPrefs; theme: string };

const current: State = {
  readingPrefs: { ...DEFAULT_READING_PREFS },
  theme: "xuan",
};

describe("mergePersistedState", () => {
  it("老存档缺新字段时补成默认值，而不是留 undefined", () => {
    // version 9 的存档：readingPrefs 只有三个字段，不会触发 migrate。
    const persisted = {
      readingPrefs: { fontSize: 19, lineWidth: 680, focusMode: false },
    };
    const merged = mergePersistedState(persisted, current);
    expect(merged.readingPrefs).toEqual(normalizeReadingPrefs(persisted.readingPrefs));
    expect(merged.readingPrefs.lineHeight).toBe(DEFAULT_READING_PREFS.lineHeight);
    expect(merged.readingPrefs.paragraphSpacing).toBe(
      DEFAULT_READING_PREFS.paragraphSpacing
    );
  });

  it("保留用户已经存下的值", () => {
    const persisted = {
      readingPrefs: normalizeReadingPrefs({
        fontSize: 21,
        lineHeight: 2.2,
        paragraphSpacing: 1.6,
      }),
    };
    const merged = mergePersistedState(persisted, current);
    expect(merged.readingPrefs.fontSize).toBe(21);
    expect(merged.readingPrefs.lineHeight).toBe(2.2);
    expect(merged.readingPrefs.paragraphSpacing).toBe(1.6);
  });

  it("没有存档时等于初始 state", () => {
    expect(mergePersistedState(undefined, current).readingPrefs).toEqual(
      DEFAULT_READING_PREFS
    );
    expect(mergePersistedState(null, current).theme).toBe("xuan");
  });

  it("其它键仍然按浅合并走", () => {
    const merged = mergePersistedState({ theme: "songyan" }, current);
    expect(merged.theme).toBe("songyan");
    expect(merged.readingPrefs).toEqual(DEFAULT_READING_PREFS);
  });
});
