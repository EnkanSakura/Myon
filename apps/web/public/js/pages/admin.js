(function () {
  "use strict";

  /* ---------------- 维护模式：真实开关 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var pageEl = document.querySelector(".page[data-settings-api]");
  var SETTINGS_API = pageEl ? pageEl.getAttribute("data-settings-api") || "" : "";

  var maintLamp = document.getElementById("maintLamp");
  var maintSwitch = document.getElementById("maintSwitch");
  var maintV = document.getElementById("maintV");
  var sideLamp = document.getElementById("sideLamp");
  var sideLampText = document.getElementById("sideLampText");
  var toastEl = document.getElementById("toast");
  var maintBusy = false;
  var toastTimer = null;

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }

  function readToken() {
    try { return (localStorage.getItem(TOKEN_KEY) || "").trim(); } catch (e) { return ""; }
  }

  /** 页面里的开关、侧栏状态都按同一份真实状态绘制。 */
  function paintMaintenance(on) {
    var open = !on;
    if (maintLamp) maintLamp.setAttribute("data-on", String(open));
    if (maintSwitch) {
      maintSwitch.setAttribute("aria-checked", String(open));
      maintSwitch.setAttribute("data-on", String(open));
    }
    if (maintV) {
      maintV.textContent = on ? "维护中 · 访客看到维护页" : "营业中 · 访客可访问";
    }
    if (sideLamp) sideLamp.setAttribute("data-on", String(open));
    if (sideLampText) sideLampText.textContent = on ? "维护中" : "营业中";
  }

  function currentMaintenance() {
    return maintLamp ? maintLamp.getAttribute("data-on") !== "true" : false;
  }

  function saveMaintenance(next) {
    if (maintBusy) return;
    var token = readToken();
    if (!token) {
      toast("需要管理令牌 · 点右上角「管理令牌」");
      return;
    }
    if (!SETTINGS_API) {
      toast("页面缺少设置接口地址");
      return;
    }
    maintBusy = true;
    if (maintSwitch) maintSwitch.disabled = true;
    if (maintV) maintV.textContent = "切换中…";
    fetch(SETTINGS_API, {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-admin-token": token
      },
      cache: "no-store",
      body: JSON.stringify({ maintenance_enabled: next ? "true" : "false" })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.ok && result.body && result.body.settings) {
          var enabled = result.body.settings.maintenance_enabled === "true";
          paintMaintenance(enabled);
          toast(enabled ? "已进入维护模式 · 前台显示维护页" : "已恢复营业 · 前台可正常访问");
          return;
        }
        if (result.status === 401) {
          toast("切换失败 · 管理令牌无效");
          return;
        }
        if (result.status === 503) {
          toast("切换失败 · 服务端未配置管理令牌");
          return;
        }
        toast("切换失败 · HTTP " + result.status);
      })
      .catch(function () {
        toast("切换失败 · 请检查网络或服务");
      })
      .then(function () {
        maintBusy = false;
        if (maintSwitch) maintSwitch.disabled = false;
        paintMaintenance(currentMaintenance());
      });
  }

  if (maintSwitch) {
    maintSwitch.addEventListener("click", function () {
      saveMaintenance(!currentMaintenance());
    });
  }

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
