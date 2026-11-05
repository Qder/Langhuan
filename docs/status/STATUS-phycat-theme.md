# Phycat 阅读主题（Typora 皮 → 琅嬛）

> 把 [typora-theme-phycat](https://github.com/sumruler/typora-theme-phycat) 的观感**改编**进琅嬛主题体系，而不是原样倾倒 `#write` CSS。
> 实现：`src/styles/phycat/`（LICENSE / NOTICE / `prose.css`）、`src/app/globals.css` 主题 token、`src/lib/theme.ts`。
> 默认仍是宣纸靛青；侧栏调色盘或命令面板可选 Phycat。

## 已上架皮

| id | 名 | 明暗 |
|----|----|------|
| `phycat` | 绯猫樱华 | 浅（sakura） |
| `phycat-mint` | 绯猫薄荷 | 浅 |
| `phycat-sky` | 绯猫晴空 | 浅 |
| `phycat-abyss` | 绯猫深渊 | 深 |

壳层走 `--bg/--fg/--accent…`；预览粉条 H2、引用✨、虚线 HR 等只在 `html[data-theme^="phycat"] .prose-langhuan` 生效，不改原五套纸面。

对比度抛光（2026-11-05）：正文用 `--fg` 墨色，不再掺 `--muted`；侧栏 `--chrome` 与纸面拉开；浅色 H2 渐变改走深朱砂/青绿，白字可辨；深渊 callout 加浓度、标题偏墨。宣纸体系未动。

加皮步骤见 `src/styles/phycat/NOTICE.md`。字体不内嵌，栈优先本机「霞鹜文楷」。
