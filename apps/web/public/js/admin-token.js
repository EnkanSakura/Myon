(function () {
  "use strict";

  /* ==========================================================================
     后台管理令牌：全后台唯一入口（顶栏按钮 + 弹窗）。
     令牌只保存在本机浏览器，读写接口在请求头里带上它。
     页面脚本只管自己的数据请求；这里只负责保存、清除与顶栏的连接状态。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var CHECK_URL = document.body.getAttribute("data-token-check") || "";

  var openBtn = document.getElementById("adminTokenOpen");
  var lamp = document.getElementById("adminTokenLamp");
  var stateEl = document.getElementById("adminTokenState");
  var dlg = document.getElementById("adminTokenDlg");
  var form = document.getElementById("adminTokenForm");
  var input = document.getElementById("adminTokenInput");
  var dlgState = document.getElementById("adminTokenDlgState");
  var msg = document.getElementById("adminTokenMsg");
  var saveBtn = document.getElementById("adminTokenSave");
  var clearBtn = document.getElementById("adminTokenClear");

  if (!openBtn || !dlg || !form || !input) return;

  var STATUS_TEXT = {
    idle: "未填写",
    checking: "校验中",
    ok: "已连接",
    bad: "令牌无效",
    readOnly: "服务端只读",
    offline: "连接失败"
  };

  function readToken() {
    try {
      return (localStorage.getItem(TOKEN_KEY) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function writeToken(value) {
    try {
      localStorage.setItem(TOKEN_KEY, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* 隐私模式下拿不到本机存储时保持原样，由保存流程提示失败 */
    }
  }

  function paint(status) {
    openBtn.setAttribute("data-state", status);
    if (stateEl) stateEl.textContent = STATUS_TEXT[status] || STATUS_TEXT.idle;
    if (lamp) lamp.setAttribute("data-on", status === "ok" ? "true" : "false");
    if (dlgState) dlgState.textContent = STATUS_TEXT[status] || STATUS_TEXT.idle;
  }

  function paintMessage(text) {
    if (msg) msg.textContent = text;
  }

  /** 令牌是否存在只说明填没填；有效性问一次后台接口。 */
  function checkConnection() {
    var token = readToken();
    if (!token) {
      paint("idle");
      return;
    }
    paint("checking");
    fetch(CHECK_URL, {
      method: "GET",
      headers: { accept: "application/json", "x-admin-token": token },
      cache: "no-store"
    })
      .then(function (response) {
        if (response.ok) {
          paint("ok");
          return;
        }
        if (response.status === 401) {
          paint("bad");
          return;
        }
        if (response.status === 503) {
          paint("readOnly");
          return;
        }
        paint("offline");
      })
      .catch(function () {
        paint("offline");
      });
  }

  function openDialog() {
    input.value = readToken();
    paintMessage(input.value ? "已填写 · 可重新保存" : "这台浏览器还没有填写令牌");
    if (readToken()) paint("checking");
    else paint("idle");
    if (typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    }
    input.focus();
    if (readToken()) checkConnection();
  }

  function closeDialog() {
    if (typeof dlg.close === "function" && dlg.open) dlg.close();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var token = input.value.trim();
    if (!token) {
      paintMessage("令牌不能为空");
      input.focus();
      return;
    }
    if (!writeToken(token)) {
      paintMessage("无法写入本机存储 · 请检查浏览器设置");
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    paint("checking");
    paintMessage("已保存 · 正在刷新页面");
    location.reload();
  });

  clearBtn.addEventListener("click", function () {
    removeToken();
    input.value = "";
    paint("idle");
    paintMessage("已清除 · 正在刷新页面");
    location.reload();
  });

  dlg.addEventListener("click", function (event) {
    if (event.target === dlg) closeDialog();
  });

  // 页面里的错误提示只需要带 data-token-open，就能打开这个弹窗。
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-token-open]");
    if (!trigger) return;
    event.preventDefault();
    openDialog();
  });

  // 弹窗关闭后按钮回到当前连接状态，避免一直停在“校验中”。
  dlg.addEventListener("close", function () {
    checkConnection();
  });

  window.MyonAdminToken = {
    open: openDialog,
    read: readToken,
    check: checkConnection
  };

  checkConnection();
})();
