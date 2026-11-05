/**
 * 读码页的两块「层」：资源管理器（窄屏是抽屉）与讲解面板。
 *
 * 桌面宽屏可以把文件树停靠在左边、讲解停在右边，两者同开是正常布局。
 * 窄屏没有两栏的余地：一次只留一层，否则抽屉和讲解会叠在一起。
 *
 * 这里只放纯规则与一次性的纠正函数，不在 useEffect 里同步 setState——
 * 互斥发生在「用户真的要求打开某一层」的那一刻，和持久化恢复的那一次。
 */

/** 宽屏（左树 + 右讲解可同开）的门槛，和 IdeShell / 顶栏共用一份。 */
export const IDE_WIDE_QUERY = "(min-width: 1024px)";

export type IdePanelLayers = {
  explorerOpen: boolean;
  explainOpen: boolean;
};

/** 双开时要保住的那一层。 */
export type IdePanelLayer = "explorer" | "explain";

/**
 * 窄屏下把「双开」收成一层；宽屏原样返回。
 *
 * 调用方传入的是「这次操作想要的最终状态」，winner 是这次操作主动打开的那层，
 * 所以用户点讲解就会收起抽屉，反过来点文件也一样。
 */
export function oneLayerOnCompact(
  layers: IdePanelLayers,
  compact: boolean,
  winner: IdePanelLayer = "explain"
): IdePanelLayers {
  if (!compact) return layers;
  if (!layers.explorerOpen || !layers.explainOpen) return layers;
  return winner === "explorer"
    ? { explorerOpen: true, explainOpen: false }
    : { explorerOpen: false, explainOpen: true };
}

/**
 * 恢复/切换工程时的唯一纠正点：持久化里两种状态可能都是 true。
 * 保留讲解（正在读的东西比目录更重要），收起抽屉。
 */
export function reconcilePanelLayers(
  layers: IdePanelLayers,
  compact: boolean
): IdePanelLayers {
  return oneLayerOnCompact(layers, compact, "explain");
}

/**
 * 「我现在要把 winner 这一层打开」——先把它置为 true，再按宽度收掉另一层。
 * store 里所有打开动作都走这里，免得每处都手写一遍合并逻辑。
 */
export function openLayer(
  layers: IdePanelLayers,
  winner: IdePanelLayer,
  compact: boolean
): IdePanelLayers {
  const wanted: IdePanelLayers =
    winner === "explorer"
      ? { explorerOpen: true, explainOpen: layers.explainOpen }
      : { explorerOpen: layers.explorerOpen, explainOpen: true };
  return oneLayerOnCompact(wanted, compact, winner);
}

/** 当前视口是否放不下两层。SSR / 无 matchMedia 时按宽屏处理（不纠正）。 */
export function isCompactIdeLayout(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return !window.matchMedia(IDE_WIDE_QUERY).matches;
}
