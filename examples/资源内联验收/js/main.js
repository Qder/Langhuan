/* 和内联无关，只用来确认「样式 / 脚本 / 资源」三种内联是同时工作的。 */
(function () {
  var stamp = document.getElementById("stamp");
  if (stamp) stamp.textContent = "脚本已执行";
})();
