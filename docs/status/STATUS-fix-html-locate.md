# HTML 预览 → 源码定位修复

## 根因
`html-elements-reference` 等页面的卡片文案在 `<script>` JSON 里动态生成。`locateInHtml` 故意跳过 script/style；匹配失败时 `precision: "none"`，`applyLocateResult` 只改状态栏、**不设** `pendingReveal` → 光标停在 Ln 1,Col 1，无闪选。

## 修复
1. **脚本回退**：静态匹配失败后，在 `<script>`/`<style>` 中查找原文（含 JSON 转义、选区两端收缩），命中则 `fuzzy` +「脚本生成，已定位到生成处（第 N 行）」并 reveal/闪选。
2. **桥接**：点击优先收紧到 `p`/`h*`；大容器优先 `data-desc` / `.desc`，减少整张卡片噪声文本。
3. 静态 HTML 原文匹配逻辑不变；MD 定位不动；sandbox 不加 `allow-same-origin`。

## 验收
1. `git pull && npm i && npm run dev`
2. 打开 `html-elements-reference`，分栏
3. 点击 h6 卡片描述 → 右侧跳到约第 442 行，闪选 `"desc": "六级…"`, 底栏「脚本生成，已定位到生成处」
4. 点击页头静态「HTML 元素参考」→ exact 定位 + 闪选
5. `npm test -- src/lib/locate`
