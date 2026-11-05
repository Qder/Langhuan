/**
 * 窄屏讲解抽屉的高度档位。
 *
 * 抽屉不再整屏盖住读码区：默认半高，上方留出顶栏 / Tab / 编辑器上半段，
 * 用户可以直接点 Tab 或读代码。点抓手在「半高 ↔ 加高」之间切换。
 * 遮罩只在加高档渲染，所以半高档时顶栏和编辑器都能点。
 */

export type ExplainSheetState = "half" | "full";

export const EXPLAIN_SHEET_HALF_VH = 62;
export const EXPLAIN_SHEET_FULL_VH = 92;

/**
 * 高度直接给内联样式：`dvh` + `min()` 走 Tailwind 任意值要过 JIT 扫描，
 * 一旦没扫到就退化成内容高度（真机上撞到过抽屉只有 390px）。这里不过 JIT。
 */
export function explainSheetHeightStyle(state: ExplainSheetState): {
  height: string;
} {
  const vh = state === "full" ? EXPLAIN_SHEET_FULL_VH : EXPLAIN_SHEET_HALF_VH;
  return { height: `min(${vh}dvh, 100dvh)` };
}

export function toggleExplainSheet(state: ExplainSheetState): ExplainSheetState {
  return state === "full" ? "half" : "full";
}

export function explainSheetToggleLabel(state: ExplainSheetState): string {
  return state === "full" ? "收起讲解" : "加高讲解";
}

/** 只有「加高」才铺遮罩；半高时要能点顶栏 Tab 和编辑器。 */
export function explainSheetHasScrim(state: ExplainSheetState): boolean {
  return state === "full";
}

/**
 * 引用跳转打开文件后，编辑器必须露出来。
 * 只有在加高档（整屏遮罩）时才自动收到半高；本来就是半高就不动，
 * 避免用户手动拉高之后又被一次跳转打回去。
 */
export function nextExplainSheetAfterJump(
  compact: boolean,
  state: ExplainSheetState,
  jumpOk: boolean
): ExplainSheetState {
  if (!compact || !jumpOk) return state;
  return state === "full" ? "half" : state;
}
