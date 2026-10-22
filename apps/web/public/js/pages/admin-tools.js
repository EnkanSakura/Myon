(function () {
  "use strict";

  /* ---------------- 提示条 ---------------- */
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-on");
    }, 3200);
  }

  /* ---------------- 启用开关 ---------------- */
  var rows = Array.prototype.slice.call(document.querySelectorAll(".trow"));
  var total = rows.length;
  var enabled = rows.filter(function (r) { return r.getAttribute("data-on") === "true"; }).length;
  var mEnabled = document.getElementById("mEnabled");
  var mDisabled = document.getElementById("mDisabled");
  var enabledCount = document.getElementById("enabledCount");
  var footEnabled = document.getElementById("footEnabled");
  var pEnabled = document.getElementById("pEnabled");

  function paint() {
    mEnabled.textContent = String(enabled);
    mDisabled.textContent = String(total - enabled);
    enabledCount.textContent = String(enabled);
    footEnabled.textContent = String(enabled);
    pEnabled.textContent = String(enabled);
  }

  rows.forEach(function (row) {
    var sw = row.querySelector(".switch");
    var txt = row.querySelector(".switch-label");
    var name = row.getAttribute("data-name");

    function setState(on) {
      row.setAttribute("data-on", String(on));
      row.classList.toggle("is-off", !on);
      sw.setAttribute("data-on", String(on));
      sw.setAttribute("aria-checked", String(on));
      sw.setAttribute("aria-label", (on ? "停用 " : "启用 ") + name);
      txt.textContent = on ? "启用中" : "已停用";
    }

    sw.addEventListener("click", function () {
      var wasOn = row.getAttribute("data-on") === "true";
      setState(!wasOn);
      enabled += wasOn ? -1 : 1;
      paint();
      toast((wasOn ? "已停用 " : "已启用 ") + name + " · 前台立即生效");
    });
  });
  paint();

  /* ---------------- 新增工具弹层 ---------------- */
  var dlg = document.getElementById("newDlg");
  var form = document.getElementById("newForm");
  var nameIn = document.getElementById("newName");
  var descIn = document.getElementById("newDesc");
  var newCancel = document.getElementById("newCancel");

  document.getElementById("btnNewTool").addEventListener("click", function () {
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
      nameIn.focus();
    }
  });
  newCancel.addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) dlg.close();
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    dlg.close();
    form.reset();
    toast("已创建「" + name + "」· 部署后出现在前台工具页");
  });
})();
