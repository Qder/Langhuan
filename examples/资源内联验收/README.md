# 资源内联验收（examples/资源内联验收）

给「项目预览里的图片 / 图标 / 字体」做的验收现场。所有资源都是**真的二进制文件**（不是占位字符串），
所以能验证到「data URL 解出来的字节和磁盘文件一致」这一层。

## 怎么用

1. 应用里 **导入文件夹** → 选这个目录（`资源内联验收`）→ 打开 `index.html`。
2. 页面六段内容都应该正常显示：logo（含 `srcset` 两档）、CSS 背景图、SVG 图标（两种用法）、
   `<picture>` 的 WebP、`video` 的 poster、自定义字体。
3. 左下角应出现一条可展开的说明：**有 1 处资源没能内联（已保留原引用）**，内容里点名 `img/missing.png`。
   这条是故意留的——用来确认「缺文件不静默丢图」。
4. 第 6 段里那句 `url(../img/not-asset.png)` 是 `content: "..."` 的输出：字符串里的 `url()` 不该被改写，
   所以它显示的是原文，而不是一长串 `data:`。

## 逐条清单

| 要验的点 | 页面上在哪 | 期望 |
| --- | --- | --- |
| `<img src>` 项目内 PNG | 第 1 段 logo | 显示渐变卡片图 |
| `<img srcset>` 两档 + 描述符 | 第 1 段同上 | 两档都内联，`1x` / `2x` 原样保留 |
| CSS 背景图、文件名带中文和空格、CSS 里写百分号编码 | 第 2 段 | 显示米色网格图（不是纯色块） |
| SVG 图标：`<img>` 用法 | 第 3 段第一行 | 星形图标 |
| SVG 图标：CSS `background: url()` 用法 | 第 3 段第二行 | 同样的星形图标 |
| `<picture>` / `<source srcset>` | 第 4 段 | 显示 WebP 版本 |
| `<video poster>` | 第 4 段 | 显示带播放圆圈的灰绿图 |
| `@font-face` + `url()` | 第 5 段 | 第一行字形明显宽于第二行（DejaVu Sans Display） |
| `data:` 引用保持原样 | 第 6 段第一行 | 蓝色圆点 |
| 字符串 / 注释里的 `url()` 不动 | 第 6 段第二行 + 源码注释 | 显示原文 `url(../img/not-asset.png)` |
| 缺文件降级 | 第 6 段第三行 | 破图占位 + 左下角说明 |
| 样式 / 脚本内联不受影响 | 全文排版 + 页脚 | 样式生效、页脚显示「脚本已执行」 |

## 文件

```
index.html                 入口（六段验收 + 反例）
css/site.css               相对 css/ 目录的 url()：背景图、@font-face、注释与字符串反例
js/main.js                 只为确认「脚本内联」和资源内联同时工作
img/logo.png               240×120
img/logo@2x.png            480×240（srcset 的 2x 档）
img/hero 背景.png           560×180，文件名故意带中文 + 空格
img/photo.webp             240×120
img/poster.jpg             320×180
img/icon.svg               星形图标
fonts/DejaVuSansDisplay.ttf  25KB，DejaVu 字体（见 fonts/LICENSE_DEJAVU.txt）
```

字体来自 DejaVu 字体家族（Bitstream Vera / DejaVu 许可，允许再分发），
许可证原文随字体放在 `fonts/LICENSE_DEJAVU.txt`。

## 自动化核对

`src/lib/inlineProject.example.test.ts` 会读这个目录的真实文件走一遍完整链路
（导入规划 → 预览前内联 → 插桩 srcDoc），断言：

- 每个 `data:` URL 解出来的字节与磁盘上的文件**逐字节相同**；
- `srcset` 两个候选各自对应自己的文件，描述符 `1x` / `2x` 保留；
- CSS 背景图（中文 + 空格 + 百分号编码）与 `@font-face` 字体都被命中，TTF 头是 `0x00010000`；
- 注释 / 字符串 / `data:` 里的 `url()` 一个字节没动；
- CSS 的行数不变（样式面板靠行号回索引）、插桩后的 `data-lh` 锚点仍指向原始源码；
- 只有 `img/missing.png` 保留原引用且产生 1 条 warning。

## 已知的浏览器行为（不是本项目的 bug）

Chrome 在 `srcset` 的候选是 `data:` URL 时，会**总是选密度最高的那个候选**
（实测：`<img srcset="<data 1x>, <data 2x>">` 在 DPR=1 下渲染的是 2x 那张；
把候选换回普通 URL 就正常选 1x）。影响仅限于「预览用了更高分辨率的那张图」，
显示结果仍然正确，只是多占一点内存。详见 `docs/status/STATUS-asset-inline.md`。
