/**
 * 索引新鲜度的纯函数：指纹比对、快照剪枝、单飞。
 *
 * 这里不碰 store、不发请求 —— 只回答一个仓库里最要紧的问题：
 * **手上这份索引还对不对得上当前源码**。
 */
import { describe, expect, it } from "vitest";
import {
  checkIndex,
  clearIndexHashMemo,
  createSingleFlight,
  currentSourceHash,
  projectTextFor,
  pruneStaleIndexes,
  sourceHash,
  type SourceSnapshot,
} from "./indexFreshness";
import { buildCssIndex, hashCss } from "./cssLocate";
import { hashJs } from "./jsIndex";
import type { ProjectMeta } from "../project";

const ROOT = "站点";
const FILE = `${ROOT}/css/site.css`;
const CSS = ".card { color: red; }\n";
const OTHER_CSS = ".card { color: blue; }\n";

const project = (root: string, files: string[]): ProjectMeta => ({
  root,
  entry: "index.html",
  files,
  external: [],
  importedAt: "2026-01-01T00:00:00.000Z",
});

const snapshot: SourceSnapshot = {
  projects: [project(ROOT, ["index.html", "css/site.css", "js/app.js"])],
  projectTexts: { [ROOT]: { "css/site.css": CSS, "js/app.js": "const a = 1;\n" } },
};

describe("sourceHash：与索引里的 hash 同一套算法", () => {
  it("CSS：与 buildCssIndex 写进索引的 hash 一致", async () => {
    const index = await buildCssIndex(FILE, CSS);
    expect(sourceHash("css", CSS)).toBe(index.hash);
    expect(sourceHash("css", CSS)).toBe(hashCss(CSS));
  });

  it("JS：与 hashJs 一致", () => {
    expect(sourceHash("js", "const a = 1;\n")).toBe(hashJs("const a = 1;\n"));
  });

  it("换一个字就不一样", () => {
    expect(sourceHash("css", CSS)).not.toBe(sourceHash("css", OTHER_CSS));
  });
});

describe("projectTextFor：从 projectTexts 摸当前源码", () => {
  it("项目内路径 → 文本", () => {
    expect(projectTextFor(snapshot, FILE)).toBe(CSS);
  });

  it("不在项目里 / 不是文本 → null（新鲜度判不出来，只好信现有索引）", () => {
    expect(projectTextFor(snapshot, "别处/style.css")).toBeNull();
    expect(projectTextFor(snapshot, `${ROOT}/css/missing.css`)).toBeNull();
  });

  it("嵌套项目取最深的根（和元素检视用的是同一套路径规则）", () => {
    const nested: SourceSnapshot = {
      projects: [project("站点", []), project("站点/子项目", ["css/site.css"])],
      projectTexts: { "站点/子项目": { "css/site.css": OTHER_CSS } },
    };
    expect(projectTextFor(nested, "站点/子项目/css/site.css")).toBe(OTHER_CSS);
  });
});

describe("checkIndex：复用 / 重建 / 判不了", () => {
  it("没有索引 → 该建", () => {
    expect(checkIndex("css", null, FILE, CSS)).toBe("stale");
  });

  it("老索引没有 hash → 该重建（换确定性）", () => {
    expect(checkIndex("css", { file: FILE, hash: "" }, FILE, CSS)).toBe("stale");
    expect(checkIndex("css", { file: FILE }, FILE, CSS)).toBe("stale");
  });

  it("hash 一致 → 复用", () => {
    expect(checkIndex("css", { file: FILE, hash: hashCss(CSS) }, FILE, CSS)).toBe("fresh");
  });

  it("hash 不一致（源码改过）→ 重建", () => {
    expect(checkIndex("css", { file: FILE, hash: hashCss(CSS) }, FILE, OTHER_CSS)).toBe("stale");
  });

  it("不知道当前源码 → unknown（不盲目重建，也不假装新鲜）", () => {
    expect(checkIndex("css", { file: FILE, hash: hashCss(CSS) }, FILE, null)).toBe("unknown");
  });

  it("same 文本重复判断走指纹缓存（结果不变）", () => {
    clearIndexHashMemo();
    const idx = { file: FILE, hash: hashCss(CSS) };
    expect(checkIndex("css", idx, FILE, CSS)).toBe("fresh");
    expect(currentSourceHash("css", FILE, CSS)).toBe(idx.hash);
    expect(checkIndex("css", idx, FILE, CSS)).toBe("fresh");
  });
});

describe("pruneStaleIndexes：快照刷新时先剔掉对不上的", () => {
  it("留新鲜的、丢过期的、留判不出来的（没源码可比的）", async () => {
    const fresh = await buildCssIndex(FILE, CSS);
    const stale = { ...(await buildCssIndex(FILE, OTHER_CSS)) };
    const unknown = await buildCssIndex(`${ROOT}/css/other.css`, ".a{}");
    const kept = pruneStaleIndexes("css", [fresh, stale, unknown], snapshot);
    expect(kept.map((i) => i.file)).toEqual([FILE, `${ROOT}/css/other.css`]);
  });
});

describe("createSingleFlight：同一 key 的并发只跑一次", () => {
  it("并发调用复用同一个 Promise，落地后可以再来一次", async () => {
    const run = createSingleFlight();
    let calls = 0;
    let release: (v: string) => void = () => {};
    const slow = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        release = resolve;
      });

    const a = run.run("css:a.css", slow);
    const b = run.run("css:a.css", slow);
    expect(calls).toBe(1);
    expect(run.size()).toBe(1);
    release("done");
    expect(await a).toBe("done");
    expect(await b).toBe("done");
    expect(run.size()).toBe(0);

    await run.run("css:a.css", async () => "again");
    expect(calls).toBe(1); // 复用的那次没再调 fn
  });

  it("不同 key 各跑各的", async () => {
    const run = createSingleFlight();
    const seen: string[] = [];
    const fn = (key: string) => async () => {
      seen.push(key);
      return key;
    };
    await Promise.all([run.run("css:a", fn("a")), run.run("js:a", fn("a"))]);
    expect(seen.sort()).toEqual(["a", "a"]);
  });

  it("失败不粘住：落地后同一 key 还能重试", async () => {
    const run = createSingleFlight();
    await expect(run.run("css:a.css", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom"
    );
    expect(run.size()).toBe(0);
    await expect(run.run("css:a.css", async () => "ok")).resolves.toBe("ok");
  });
});
