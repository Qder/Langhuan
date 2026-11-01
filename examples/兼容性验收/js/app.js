/*
 * 这个脚本带 defer（见 index.html）。
 * 内联进预览时 defer 会被去掉 → 它变成「在 head 里原地同步执行」，
 * 那时 #defer-out 还没被解析出来，所以下面这段拿不到元素。
 * 这里特意不抛异常，好让你看清「是执行时机变了」，而不是代码坏了。
 */
( function () {
  var probe = document.querySelector( "#defer-out" );
  if ( probe ) {
    probe.textContent = "defer 脚本跑到了，而且 DOM 已经就绪";
    probe.style.borderLeftColor = "#1a7f37";
  } else {
    console.warn( "[兼容性验收] defer 脚本在 DOM 就绪前就执行了：#defer-out 还不存在" );
  }
} )();
