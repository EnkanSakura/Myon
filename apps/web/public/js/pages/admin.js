(function () {
  "use strict";

  /* ---------------- 前台灯：两态 ---------------- */
  var body = document.body;
  var lamp = document.getElementById("lamp");
  var lampSwitch = document.getElementById("lampSwitch");
  var lampV = document.getElementById("lampV");
  var sideLamp = document.getElementById("sideLamp");
  var sideLampText = document.getElementById("sideLampText");

  function setLamp(on) {
    lamp.dataset.on = String(on);
    lampSwitch.setAttribute("aria-checked", String(on));
    body.classList.toggle("front-off", !on);
    lampV.textContent = on ? "亮着 · 访客可访问" : "前台已关灯 · 访客看到维护页";
    sideLamp.dataset.on = String(on);
    sideLampText.textContent = on ? "营业中" : "已打烊 · 维护页";
  }
  lampSwitch.addEventListener("click", function () {
    setLamp(lamp.dataset.on !== "true");
  });

  /* ---------------- 访问曲线：hover 看每天 ---------------- */
  var chart = document.getElementById("chart");
  var chartSvg = chart.querySelector(".chart-svg");
  var tip = document.getElementById("tip");
  var tipDate = document.getElementById("tipDate");
  var tipPv = document.getElementById("tipPv");
  var tipUv = document.getElementById("tipUv");
  var hGuide = document.getElementById("hGuide");
  var hDot = document.getElementById("hDot");
  var VIEW_W = 1120;
  var weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  function showTip(hit) {
    var x = parseFloat(hit.dataset.x);
    var y = parseFloat(hit.dataset.y);
    hGuide.setAttribute("x1", x);
    hGuide.setAttribute("x2", x);
    hGuide.setAttribute("opacity", "1");
    hDot.setAttribute("cx", x);
    hDot.setAttribute("cy", y);
    hDot.setAttribute("opacity", "1");

    // 星期由服务端按真实日期算好写在 data-w（0 = 周一），不要按序号取模。
    var w = parseInt(hit.dataset.w, 10);
    tipDate.textContent =
      hit.dataset.d + " · " + (weekdays[w] || weekdays[0]);
    tipPv.textContent = Number(hit.dataset.pv).toLocaleString("en-US");
    tipUv.textContent = Number(hit.dataset.uv).toLocaleString("en-US");
    tip.hidden = false;

    var scale = chart.clientWidth / VIEW_W;
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var left = Math.min(Math.max(x * scale, tw / 2 + 4), chart.clientWidth - tw / 2 - 4);
    var top = y * scale - 12;
    if (top < th + 10) top = y * scale + th + 26;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() {
    tip.hidden = true;
    hGuide.setAttribute("opacity", "0");
    hDot.setAttribute("opacity", "0");
  }
  chartSvg.addEventListener("pointerover", function (e) {
    var hit = e.target.closest(".hit");
    if (hit) showTip(hit);
  });
  chartSvg.addEventListener("pointerleave", hideTip);
})();
