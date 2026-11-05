// @vitest-environment jsdom
/**
 * 读码页窄屏「一次只开一层」的契约。
 *
 * 以前 IdeShell 用 useEffect 盯着 explainOpen && explorerOpen 去关抽屉，
 * React Compiler 把这种同步 setState 标成 set-state-in-effect，而且它会在
 * 任何一次「两个布尔恰好同真」的渲染里悄悄改状态。现在规则只在两处生效：
 *
 *  - 用户真的要求打开某一层时（setExplorerOpen / setExplainOpen / 切换）；
 *  - 持久化恢复 / 换工程时纠正一次（reconcilePanels）。
 *
 * 这里同时锁住宽屏不纠正、以及 IdeShell 里不再有那个 effect。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// jsdom 没有 indexedDB：persist 中间件写状态会在这里抛错。用内存实现替掉，
// 这条测试关心的是「两层开关」，不是持久化存储本身。
vi.mock("idb-keyval", () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => {
      mem.set(k, v);
    },
    del: async (k: string) => {
      mem.delete(k);
    },
  };
});

import {
  IDE_WIDE_QUERY,
  isCompactIdeLayout,
  oneLayerOnCompact,
  openLayer,
  reconcilePanelLayers,
} from "./panelLayers";
import { useIdeStore } from "./store";

/** 让 isCompactIdeLayout() 认为当前是窄屏 / 宽屏。 */
function mockViewport(compact: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === IDE_WIDE_QUERY ? !compact : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

function layers() {
  const s = useIdeStore.getState();
  return { explorerOpen: s.explorerOpen, explainOpen: s.explainOpen };
}

describe("oneLayerOnCompact（纯规则）", () => {
  it("窄屏双开 → 只留这次操作要开的那层", () => {
    expect(
      oneLayerOnCompact({ explorerOpen: true, explainOpen: true }, true, "explain")
    ).toEqual({ explorerOpen: false, explainOpen: true });
    expect(
      oneLayerOnCompact({ explorerOpen: true, explainOpen: true }, true, "explorer")
    ).toEqual({ explorerOpen: true, explainOpen: false });
  });

  it("只有一层时不动", () => {
    expect(
      oneLayerOnCompact({ explorerOpen: true, explainOpen: false }, true, "explain")
    ).toEqual({ explorerOpen: true, explainOpen: false });
    expect(
      oneLayerOnCompact({ explorerOpen: false, explainOpen: true }, true, "explorer")
    ).toEqual({ explorerOpen: false, explainOpen: true });
    expect(
      oneLayerOnCompact({ explorerOpen: false, explainOpen: false }, true, "explain")
    ).toEqual({ explorerOpen: false, explainOpen: false });
  });

  it("宽屏允许左树 + 右讲解同开，规则不插手", () => {
    const both = { explorerOpen: true, explainOpen: true };
    expect(oneLayerOnCompact(both, false, "explain")).toEqual(both);
    expect(oneLayerOnCompact(both, false, "explorer")).toEqual(both);
  });

  it("官方纠正保留讲解（正在读的东西优先于目录）", () => {
    expect(
      reconcilePanelLayers({ explorerOpen: true, explainOpen: true }, true)
    ).toEqual({ explorerOpen: false, explainOpen: true });
  });

  it("openLayer 先置真再收另一层（宽屏则两层都在）", () => {
    expect(openLayer({ explorerOpen: false, explainOpen: false }, "explorer", true)).toEqual({
      explorerOpen: true,
      explainOpen: false,
    });
    expect(openLayer({ explorerOpen: false, explainOpen: true }, "explorer", true)).toEqual({
      explorerOpen: true,
      explainOpen: false,
    });
    expect(openLayer({ explorerOpen: true, explainOpen: false }, "explain", true)).toEqual({
      explorerOpen: false,
      explainOpen: true,
    });
    expect(openLayer({ explorerOpen: true, explainOpen: false }, "explain", false)).toEqual({
      explorerOpen: true,
      explainOpen: true,
    });
  });
});

describe("store：窄屏双开意图只留一层", () => {
  beforeEach(() => {
    mockViewport(true); // 768 宽
    useIdeStore.setState({ explorerOpen: false, explainOpen: false });
  });

  it("先开抽屉再点讲解 → 抽屉收起，只留讲解", () => {
    useIdeStore.getState().setExplorerOpen(true);
    expect(layers()).toEqual({ explorerOpen: true, explainOpen: false });

    useIdeStore.getState().setExplainOpen(true);
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: true });
  });

  it("先开讲解再点抽屉 → 讲解收起，只留抽屉", () => {
    useIdeStore.getState().setExplainOpen(true);
    useIdeStore.getState().setExplorerOpen(true);
    expect(layers()).toEqual({ explorerOpen: true, explainOpen: false });
  });

  it("toggleExplainOpen 也走同一条互斥", () => {
    useIdeStore.getState().setExplorerOpen(true);
    useIdeStore.getState().toggleExplainOpen();
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: true });
    // 再 toggle 一次是关掉，不该把抽屉带回来。
    useIdeStore.getState().toggleExplainOpen();
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: false });
  });

  it("关闭某一层不会顺手打开另一层", () => {
    useIdeStore.getState().setExplainOpen(true);
    useIdeStore.getState().setExplainOpen(false);
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: false });
  });

  it("恢复时双开（旧持久化）→ reconcile 收成讲解一层", () => {
    useIdeStore.setState({ explorerOpen: true, explainOpen: true });
    useIdeStore.getState().reconcilePanels();
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: true });
  });

  it("跳文件不再硬弹抽屉：讲解开着时只准备 reveal，不抢这一层", async () => {
    useIdeStore.setState({
      session: {
        id: "s1",
        name: "demo",
        pathLabel: "demo",
        handle: {} as FileSystemDirectoryHandle,
        absRoot: null,
      },
      tabs: [
        { path: "src/A.java", savedContent: "x\n", draft: "x\n" },
      ],
      activePath: null,
      children: { "": [] },
      expanded: { "": true },
      explainOpen: true,
      explorerOpen: false,
      pendingExplorerReveal: null,
    });
    const ok = await useIdeStore.getState().openFile("src/A.java");
    expect(ok).toBe(true);
    const s = useIdeStore.getState();
    expect(s.explorerOpen).toBe(false);
    expect(s.explainOpen).toBe(true);
    expect(s.pendingExplorerReveal?.path).toBe("src/A.java");
    expect(s.expanded["src"]).toBe(true);
  });

  it("persist 恢复双开状态 → rehydrate 自己纠正一次（不必等 effect）", async () => {
    const { set: idbSet } = await import("idb-keyval");
    // 先把内存状态清零（这一步也会写回 storage），再放一份「双开」的持久化，
    // 模拟上个版本 / 宽屏留下的状态。
    useIdeStore.setState({ explorerOpen: false, explainOpen: false });
    await idbSet(
      "langhuan-ide-store",
      JSON.stringify({
        state: { explorerOpen: true, explainOpen: true },
        version: 5,
      })
    );
    await useIdeStore.persist.rehydrate();
    expect(layers()).toEqual({ explorerOpen: false, explainOpen: true });
  });
});

describe("store：宽屏保持左树 + 右讲解同开", () => {
  beforeEach(() => {
    mockViewport(false); // 1440 宽
    useIdeStore.setState({ explorerOpen: false, explainOpen: false });
  });

  it("两层互不影响", () => {
    useIdeStore.getState().setExplorerOpen(true);
    useIdeStore.getState().setExplainOpen(true);
    expect(layers()).toEqual({ explorerOpen: true, explainOpen: true });
  });

  it("reconcile 在宽屏是 no-op", () => {
    useIdeStore.setState({ explorerOpen: true, explainOpen: true });
    useIdeStore.getState().reconcilePanels();
    expect(layers()).toEqual({ explorerOpen: true, explainOpen: true });
  });
});

describe("isCompactIdeLayout", () => {
  it("按 1024 断点判定，无 matchMedia 时按宽屏", () => {
    mockViewport(true);
    expect(isCompactIdeLayout()).toBe(true);
    mockViewport(false);
    expect(isCompactIdeLayout()).toBe(false);
    vi.stubGlobal("matchMedia", undefined);
    expect(isCompactIdeLayout()).toBe(false);
  });
});

describe("IdeShell 里不再用 effect 同步两个开关", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/ide/IdeShell.tsx"),
    "utf8"
  );
  const effectDeps = [...src.matchAll(/React\.useEffect\([\s\S]*?\}, \[([^\]]*)\]\);/g)]
    .map((m) => m[1] ?? "");

  it("没有任何 effect 同时依赖两个层开关", () => {
    expect(effectDeps.length).toBeGreaterThan(0); // 正则没匹配上时要响
    for (const deps of effectDeps) {
      const names = deps.split(",").map((d) => d.trim());
      const both =
        names.includes("explainOpen") && names.includes("explorerOpen");
      expect(both).toBe(false);
    }
  });

  it("effect 里不再因「另一层开着」而关层（只剩 Esc 那条键事件）", () => {
    const bodies = [...src.matchAll(/React\.useEffect\(([\s\S]*?)\}, \[[^\]]*\]\);/g)]
      .map((m) => m[1] ?? "");
    expect(bodies.length).toBe(effectDeps.length);
    for (const body of bodies) {
      // 讲解面板自己管关闭，effect 里不该有人替它关。
      expect(body).not.toContain("setExplainOpen(");
      // 抽屉唯一允许的 effect 内关闭是 Esc 监听（真实按键事件，不是同步副作用）。
      if (body.includes("setExplorerOpen(")) {
        expect(body).toContain('e.key === "Escape"');
      }
    }
  });

  it("互斥逻辑在 store 里，而不是组件渲染阶段", () => {
    expect(src).not.toMatch(/explainOpen\s*&&\s*explorerOpen/);
    expect(src).toContain("setExplorerOpen(next)");
    expect(src).toContain("setExplainOpen(next)");
  });
});
