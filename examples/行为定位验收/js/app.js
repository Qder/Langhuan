/* 行为定位验收 · 交互脚本
 *
 * 四种情况各一处：
 *   ① #btn 直接绑定（第 12 行） → 精确
 *   ② #todo-list 事件委托 → 点 <li> 时落到父元素
 *   ③ document 监听 → 面板底部「页面级监听」
 */
function onSaveClick(event) {
  event.preventDefault();
}

document.getElementById("btn").addEventListener("click", onSaveClick);

document.getElementById("todo-list").addEventListener("click", function onTodoClick(e) {
  var row = e.target.closest ? e.target.closest("li") : null;
  if (!row) return;
  row.classList.toggle("done");
});

document.addEventListener("keydown", function onKeydown(e) {
  if (e.key !== "Escape") return;
  document.getElementById("btn").blur();
});

/* 绑定对象是变量：静态上仍能解析回 #reset */
const reset = document.getElementById("reset");
reset.addEventListener("click", function onReset() {
  document.querySelectorAll("#todo-list li").forEach(function (li) {
    li.classList.remove("done");
  });
});

/* 绑定对象是参数：静态归属不到 → 面板说「无法静态归属」 */
function bindHover(el) {
  el.addEventListener("mouseenter", function () {});
}
bindHover(document.getElementById("plain"));
