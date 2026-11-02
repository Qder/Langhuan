# Phycat 主题适配说明

本目录样式改编自 Typora 主题
[typora-theme-phycat](https://github.com/sumruler/typora-theme-phycat)
（MIT，Copyright © 2024 徐继龙）。完整许可见同目录 `LICENSE`。

## 琅嬛里怎么用

侧栏调色盘或命令面板切换主题：

| id | 界面名 | 来源皮 |
|----|--------|--------|
| `phycat` | 绯猫樱华 | sakura（默认浅色） |
| `phycat-mint` | 绯猫薄荷 | mint |
| `phycat-sky` | 绯猫晴空 | sky |
| `phycat-abyss` | 绯猫深渊 | abyss（深色伴侣） |

应用壳层颜色走现有 `--bg / --fg / --accent …` token；Markdown 预览的粉条标题、引用、虚线分隔等只在
`html[data-theme^="phycat"] .prose-langhuan` 下生效，不会改掉宣纸 / 竹影等原主题纸面。

## 字体

上游自带霞鹜文楷 + Cascadia。仓库**不**内嵌多 MB 字体文件；预览栈为：

`"LXGW WenKai", "Noto Serif SC", Optima, Georgia, serif`

本机若已安装霞鹜文楷会自动用上，否则回退系统中文衬线。

## 再加一套上游皮

1. 在上游仓库取 `phycat-*.css` 里的 `--element-color*` / `--head-title-*`。
2. `src/lib/theme.ts` 的 `THEME_IDS` / `THEME_LABELS` / `THEME_HINTS` / `THEME_SWATCHES` 加一项；深色皮加入 `DARK_THEMES`。
3. `src/lib/types.ts` 的 `ThemeMode` 同步。
4. `src/app/globals.css` 写一套 `html[data-theme="phycat-…"]` token（含 `--phycat-*`），浅色可并进现有浅色 `--code-*` 组。
5. `src/app/layout.tsx` 的 FOUC `ids` 表补上；命令面板可仿现有主题项加一条。
6. `prose.css` 已用 `data-theme^="phycat"`，一般不用改。
7. 跑 `npm run check`（`theme.test` / `proseContrast` 会覆盖新 id）。

**不要**把 Typora 的 `#write` CSS 原样贴进全局——DOM 对不上，也会污染应用壳。
