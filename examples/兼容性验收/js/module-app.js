// 模块脚本：预览里的 srcDoc 没有真实网址可解析，`./greet.js` 加载不了，
// 所以整支模块不会执行 —— #module-out 会一直停在初始文字。
import { greet } from "./greet.js";

var probe = document.querySelector( "#module-out" );
if ( probe ) {
  probe.textContent = greet( "琅嬛" );
  probe.style.borderLeftColor = "#1a7f37";
}
