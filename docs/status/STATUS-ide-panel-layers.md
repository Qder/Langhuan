# 读码 · 资源管理器与讲解的层规则 — 实现说明

`IdeShell` 里两块浮层（资源管理器、讲解）在不同宽度下有不同共存规则。这份文档记录规则、为什么这样切、
以及需要人眼确认的那几条。

## 规则

| 宽度 | 资源管理器 | 讲解 | 可否同开 |
|------|-----------|------|----------|
| < 1024（手机 / 768 平板） | 左侧抽屉（带遮罩） | 底部抽屉，**默认半高 62dvh**、抓手可加高到 92dvh | **不能**，一次只留一层 |
| ≥ 1024（桌面 lg） | 左侧停靠 | 右侧停靠 | **可以**，左树 + 右讲解是正常布局 |

### 窄屏讲解抽屉为什么不铺满

早先讲解抽屉是 `inset-0` 遮罩 + `max-h-70dvh` 底部面板，遮罩把顶栏 Tab 和编辑器全盖住：
开着讲解就切不了文件，引用跳转打开了文件也看不见。现在：

- **默认半高**（`62dvh`，`explainSheetHeightStyle`），上方露出顶栏 + Tab + 编辑器上半段；
- **抓手可切换**半高 ↔ 加高（`92dvh`，`toggleExplainSheet`），按钮文案「加高讲解 / 收起讲解」；
- **遮罩只在加高档渲染**（`explainSheetHasScrim`），半高档顶栏 Tab、编辑器、资源树都能直接点；
- **引用芯片跳转成功后**，若正在加高档会自动收成半高（`nextExplainSheetAfterJump`），让刚打开的文件立即可见；本来就是半高则不动，不打断用户手动拉的高度；
- 高度走内联样式而不是 Tailwind 任意值类名，避免 JIT 没扫到时退化成内容高度。

规则是纯函数，在 `src/lib/ide/explainSheet.ts`（`explainSheet.test.ts` 钉住档位、遮罩条件、跳转自动半收、宽屏不参与）。
`IdeShell` 只负责在窄屏且 `explainOpen` 时渲染 `<IdeExplainPanel>`；抽屉外壳是 `explain/ExplainSheet.tsx`。

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

「宽屏开着两层 → 把窗口拖窄」不经过任何打开动作，两个标记会同时留着。这一条不做成 effect
（那正是要去掉的东西），而是在渲染时按 `isExplorerLayerVisible()` 收敛：窄屏讲解优先显示，
抽屉标记保留着，拖回宽屏左树自己回来。同理，拖窄后点「文件」用 `toggleExplorerLayers()`
判断「眼前有没有抽屉」，而不是看原始标记，避免「点了没反应」。

## 手测清单

浏览器：Chrome / Edge（本机 `npm run dev` → `http://localhost:3000` → 顶栏切到「读码」）。
先「打开文件夹」选一个本地工程，让资源管理器里有文件。

### 768 × 1024（平板，窄屏分支）

- [x] 点顶栏「文件」→ 抽屉从左滑出，有遮罩；再点遮罩或 Esc 收起。
- [x] 抽屉开着时点「讲解」→ **抽屉先收，底部讲解抽屉出现**（半高）；不会两层叠着。
- [x] 讲解半高时**直接点顶栏 Tab** → 能切文件，编辑器上半段可见。（768×1024：点 `format.ts` 后
      编辑器正文换成 `formatPrice(cents…)`；半高档遮罩数为 0。）
- [x] 讲解半高时点抓手 → 加高到 92dvh 并出现遮罩；再点抓手 / 遮罩 → 回半高 / 关讲解。
      实测 62dvh=634.875px / 92dvh=942px，抓手文案在「加高讲解 / 收起讲解」间切换。
- [x] 讲解加高时点「本次引用」芯片 → 文件打开，抽屉自动收成半高，正文可见。
      实测 `MerchantMapper.java:7`：抽屉回 62dvh、遮罩归 0、编辑器露出约 264px。
- [ ] 讲解开着时点「文件」→ 讲解收起，左侧文件抽屉出现。
- [ ] 讲解开着时点文件（从「打开文件」按钮或选择文件）→ 讲解仍开着，目录不弹出来；
      再点「文件」，目录是展开好的、能定位到刚才那个文件。
- [ ] 刷新页面（讲解开着、抽屉也开着地离开）→ 回来只剩讲解一层。
- [ ] 先开到 1440 让左树 + 右讲解同开，再把窗口拖到 768 → **只剩讲解**，抽屉不叠在上面；
      拖回 1440 → 左树自己回来（标记没被丢掉）。
- [ ] 上一条之后在 768 点「文件」→ 抽屉出现、讲解收起（不是点了没反应）。
- [ ] `Ctrl/⌘+Shift+L` 切讲解、`Ctrl/⌘+B` 切目录，同样一次只留一层。

### 1440 × 900（桌面 lg）

- [ ] 顶栏左侧是「切换文件树」图标（不是汉堡）。
- [ ] 目录停靠在左、讲解停靠在右，**两者可以同时开着**互不影响；1440 下不应再出现一份带遮罩的抽屉。
- [ ] 关掉讲解，左侧目录仍在；关掉目录，右侧讲解仍在。
- [ ] 刷新后两者都还开着（宽屏不纠正）。

### 不做什么

- 不做终端，不做多面板分栏。读码页仍然是「藏书阁」旁边的一张工作台：
  左树看工程、中间读文件、右边问讲解。

## 关键文件

- `src/lib/ide/panelLayers.ts` — 纯规则（`oneLayerOnCompact` / `reconcilePanelLayers` / `isCompactIdeLayout`）
- `src/lib/ide/explainSheet.ts` — 窄屏讲解抽屉档位（`explainSheetHeightStyle` / `explainSheetHasScrim` /
  `toggleExplainSheet` / `nextExplainSheetAfterJump`）
- `src/components/ide/explain/ExplainSheet.tsx` — 抽屉外壳：半高面板 + 抓手 + 仅加高档的遮罩
- `src/lib/ide/store.ts` — 在 `setExplorerOpen` / `setExplainOpen` / `toggleExplainOpen` /
  `reconcilePanels` / `revealInExplorer` 上应用规则；`onRehydrateStorage` 纠正一次
- `src/components/ide/IdeShell.tsx` — 只有渲染与事件，不再有同步 setState 的 effect
- `src/lib/ide/panelLayers.test.ts` — 窄屏互斥、宽屏共存、rehydrate 纠正、IdeShell 无该 effect 的守卫
- `src/lib/ide/explainSheet.test.ts` — 抽屉档位、遮罩条件、跳转自动半收、宽屏不参与

## 验收状态

- `npx eslint src/components/ide/IdeShell.tsx` → **0 problem**（该文件的 `set-state-in-effect`
  与 `exhaustive-deps` 都已消失）。
- `npm run check` → 129 test files / 1521 passed + 1 expected fail / 0 errors。
- 自动化覆盖：`panelLayers.test.ts`（21 例）锁住窄屏双开只留一层、宽屏共存、rehydrate 纠正、
  跳文件不抢层、拖窄时按可见性收敛、宽屏不渲染抽屉，以及「IdeShell 没有 effect 同时依赖两个开关 /
  effect 里不关层」。
- 浏览器实测（DevTools 设备模拟，非真机）：768 宽下抽屉与讲解互换只留一层、刷新后仍只一层、
  拖窄后点「文件」能收讲解露出抽屉；1440 宽下左树与右讲解可同开且不再多渲染一份抽屉。
- 窄屏讲解抽屉改成半高后（2026-11-06 复测，768×1024，qa-goto）：抽屉 `height: min(62dvh, 100dvh)`
  → 实测 634.875px，`top=365`；**半高档遮罩数量 0**，`elementFromPoint` 打在顶栏「读码」Tab 与
  文件 Tab `format.ts` 上命中的都是 Tab 自身（不是遮罩），点 `format.ts` 能切到该文件，编辑器正文
  随之换成 `formatPrice`。顶栏文件 Tab 在 y=56，永在抽屉顶部之上。
- **引用芯片跳转自动半收（已实测）**：先把抓手点到加高档（`min(92dvh,…)` → 942px、`top=58`、
  遮罩 1 个、抓手文案变「收起讲解」），再点「本次引用」的 `MerchantMapper.java:7` 芯片 →
  抽屉自动回到 `min(62dvh,…)`（`top=365`）、遮罩归 0、抓手文案变回「加高讲解」，新 Tab
  `MerchantMapper.java` 打开，状态栏 `已打开 …MerchantMapper.java:7`，编辑器在抽屉上方露出约 264px。
- 窄屏互斥（2026-11-06 复测）：讲解半高时点顶栏「文件」→ 讲解关闭、只剩目录抽屉一层，
  `.absolute.inset-0.z-40` 与 `bg-black` 遮罩各 1 个，没有两层叠加。
- 宽屏不回归（2026-11-06 复测，1440×900）：讲解是右侧停靠宽 380px（`left=1060`、`top=56`），
  **无内联 height、无抓手、无遮罩**；点「切换文件树」后讲解仍开着。
- 高度不是 Tailwind 任意值类名：首版写 `h-[min(62dvh,100dvh)]`，JIT 未扫到，实测仍是 394px 内容高；
  改内联 `style={{ height }}` 后按视口百分比生效。
- 模拟器平板几何（2026-11-05，`1536×2048 @ 320dpi` ≈ 768×1024 dp，x86_64 debug APK）：
  藏书阁顶栏「更多」、藏书阁\|读码可点。**读码里抽屉↔讲解互斥手势整段未点完**（当时卡在目录选择 NPE；代码已挡住假「打开工程」，但互斥清单仍算未跑完）。
- **实体平板：仍阻塞 / 未验**。2026-11-05 18:35 `adb devices` 空，没有型号、没有 `adb install` Success，768 真机触控不能签过。
- **未验**：Tauri 桌面窗口（WebView 的 `matchMedia` 与实际窗口宽度一致时才等同浏览器行为）；讲解请求打完一轮后的布局。
