# @import 展平验收

`css/site.css` 用 `@import "./theme/base.css"`；`base.css` 里有 `@font-face` 与背景图（路径相对 `css/theme/`）。

## 怎么用

1. 「导入项目」选本文件夹。
2. 打开 `index.html`，切到预览。

## 应该看到

- 紫色提示框（`.from-import`）可见。
- 背景图与演示字体生效。
- 兼容性横条**不会**再把这条 `@import` 算作「未展平」。
- 若把 import 改成不存在的文件，条上应出现「找不到」。
