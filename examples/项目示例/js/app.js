(function () {
  var btn = document.getElementById("go");
  var msg = document.getElementById("msg");
  var clicks = 0;

  if (!btn || !msg) return;

  btn.addEventListener("click", function () {
    clicks += 1;
    msg.textContent = "脚本生效了，这是第 " + clicks + " 次点击。";
    btn.classList.add("pressed");
  });
})();
