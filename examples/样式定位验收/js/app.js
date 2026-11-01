/* 样式定位验收 · 交互脚本
 *
 * 只做一件事：运行时往 <head> 里插一条 <style>。
 * 这条规则不在 CSS 索引里，所以面板必须把它标成「推断 / 规则来自动态注入」。
 * （写得很保守，任何一步失败都不影响页面。）
 */
(function () {
  try {
    var style = document.createElement("style");
    style.id = "dyn-style";
    style.appendChild(
      document.createTextNode(
        ".injected { outline: 2px dashed #c0563f; outline-offset: 2px; }"
      )
    );
    (document.head || document.documentElement).appendChild(style);
  } catch {
    /* 预览环境禁了也不该影响验收的其他项 */
  }

  try {
    var btn = document.getElementById("inject-more");
    if (btn) {
      btn.addEventListener("click", function () {
        var live = document.getElementById("live-count");
        var style = document.getElementById("dyn-style");
        if (!style || !live) return;
        var n = Number(live.getAttribute("data-n") || "0") + 1;
        live.setAttribute("data-n", String(n));
        live.textContent = String(n);
        style.appendChild(
          document.createTextNode(
            "\n.injected-live-" + n + " { text-decoration: underline dotted; }"
          )
        );
        var target = document.getElementById("injected");
        if (target) target.classList.add("injected-live-" + n);
      });
    }
  } catch {}
})();
