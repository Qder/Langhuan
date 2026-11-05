# 读码 · 资源管理器与讲解的层规则 — 实现说明

`IdeShell` 里两块浮层（资源管理器、讲解）在不同宽度下有不同共存规则。这份文档记录规则、为什么这样切、
以及需要人眼确认的那几条。

## 规则

| 宽度 | 资源管理器 | 讲解 | 可否同开 |
|------|-----------|------|----------|
| < 1024（手机 / 768 平板） | 左侧抽屉（带遮罩） | 底部抽屉（带遮罩） | **不能**，一次只留一层 |
| ≥ 1024（桌面 lg） | 左侧停靠 | 右侧停靠 | **可以**，左树 + 右讲解是正常布局 |

窄屏的「只留一层」现在只有两个触发点：

1. **用户真的要求打开某一层**。`setExplorerOpen(true)` / `setExplainOpen(true)` / `toggleExplainOpen()`
   在 store 里调 `oneLayerOnCompact(...)`，以「这次操作要开的那层」为准收掉另一层。
   所以点讲解会收起抽屉，反过来点文件也是这样，谁后点谁留下。
2. **一次性的恢复纠正**。持久化里可能同时存着两个 `true`（上次在宽屏留的，或者更早的版本写的）。
   `reconcilePanels()` 在 `persist` 的 `onRehydrateStorage` 和打开 / 切换工程时各跑一次，
   窄屏下保留讲解、收起抽屉。宽屏是 no-op。

以前这里是个 `useEffect([explainOpen, explorerOpen])`，两个布尔同真就 `setExplorerOpen(false)`：
React Compiler 会报 `react-hooks/set-state-in-effect`，而且它在渲染阶段改了状态，
「为什么抽屉自己关了」很难追。现在组件只负责渲染，规则在 store。

跳文件（打开引用 / 搜索结果）会展开目录并置 `pendingExplorerReveal`。窄屏且讲解正开着时
**不会**强行弹抽屉——展开状态和 reveal 都留着，用户点开抽屉时自然滚到那一行。

## 手测清单

浏览器：Chrome / Edge（本机 `npm run dev` → `http://localhost:3000` → 顶栏切到「读码」）。
先「打开文件夹」选一个本地工程，让资源管理器里有文件。

### 768 × 1024（平板，窄屏分支）

- [ ] 点顶栏「文件」→ 抽屉从左滑出，有遮罩；再点遮罩或 Esc 收起。
- [ ] 抽屉开着时点「讲解」→ **抽屉先收，底部讲解抽屉出现**；不会两层叠着。
- [ ] 讲解开着时点「文件」→ 讲解收起，左侧文件抽屉出现。
- [ ] 讲解开着时点文件（从「打开文件」按钮或选择文件）→ 讲解仍开着，目录不弹出来；
      再点「文件」，目录是展开好的、能定位到刚才那个文件。
- [ ] 刷新页面（讲解开着、抽屉也开着地离开）→ 回来只剩讲解一层。
- [ ] `Ctrl/⌘+Shift+L` 切讲解、`Ctrl/⌘+B` 切目录，同样一次只留一层。

### 1440 × 900（桌面 lg）

- [ ] 顶栏左侧是「切换文件树」图标（不是汉堡）。
- [ ] 目录停靠在左、讲解停靠在右，**两者可以同时开着**互不影响。
- [ ] 关掉讲解，左侧目录仍在；关掉目录，右侧讲解仍在。
- [ ] 刷新后两者都还开着（宽屏不纠正）。

### 不做什么

- 不做终端，不做多面板分栏，不做「像 VS Code 一样」的布局。读码页仍然是「藏书阁」旁边的一张工作台：
  左树看工程、中间读文件、右边问讲解。

## 关键文件

- `src/lib/ide/panelLayers.ts` — 纯规则（`oneLayerOnCompact` / `reconcilePanelLayers` / `isCompactIdeLayout`）
- `src/lib/ide/store.ts` — 在 `setExplorerOpen` / `setExplainOpen` / `toggleExplainOpen` /
  `reconcilePanels` / `revealInExplorer` 上应用规则；`onRehydrateStorage` 纠正一次
- `src/components/ide/IdeShell.tsx` — 只有渲染与事件，不再有同步 setState 的 effect
- `src/lib/ide/panelLayers.test.ts` — 窄屏互斥、宽屏共存、rehydrate 纠正、IdeShell 无该 effect 的守卫

## 验收状态

- `npx eslint src/components/ide/IdeShell.tsx` → **0 problem**（该文件的 `set-state-in-effect`
  与 `exhaustive-deps` 都已消失）。
- `npm run check` → 129 test files / 1518 passed + 1 expected fail / 0 errors。
- 自动化覆盖：`panelLayers.test.ts`（18 例）锁住窄屏双开只留一层、宽屏共存、rehydrate 纠正、
  跳文件不抢层，以及「IdeShell 没有 effect 同时依赖两个开关 / effect 里不关层」。
- 浏览器实测（DevTools 设备模拟，非真机）：768 宽下抽屉与讲解互换只留一层、刷新后仍只一层；
  1440 宽下左树与右讲解可同开。
- **未验**：真机平板（768 分辨率实设备）触屏点选、Tauri 桌面窗口（WebView 的 `matchMedia`
  与实际窗口宽度一致时才等同浏览器行为）、以及讲解请求打完一轮后的布局（本次只测开合）。
