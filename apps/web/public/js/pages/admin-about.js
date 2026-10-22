(function () {
  "use strict";

  var KEY = "myon-about";
  var input = document.getElementById("mdInput");
  var preview = document.getElementById("mdPreview");
  var counts = document.getElementById("mdCounts");
  var sourceTag = document.getElementById("sourceTag");
  var saveState = document.getElementById("saveState");
  var saveBtn = document.getElementById("saveBtn");
  var resetBtn = document.getElementById("resetBtn");
  var toastEl = document.getElementById("toast");
  var DEF = window.MYON_ABOUT_DEFAULT || "# 关于 Myon\n\n这里还没有内容。";

  var dirty = false;
  var saveTimer = null;
  var resetTimer = null;
  var toastTimer = null;
  var stateTimer = null;

  function readStore() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function writeStore(v) {
    try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; }
  }
  function clearStore() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }
  function setState(text, on) {
    saveState.textContent = text;
    saveState.classList.toggle("is-on", !!on);
  }
  function setSource(text) { sourceTag.textContent = text; }
  function stats(md) {
    var chars = md.replace(/\s/g, "").length;
    var paras = md.split(/\n\s*\n/).filter(function (s) { return s.trim().length > 0; }).length;
    var heads = (md.match(/^#{1,3}\s/gm) || []).length;
    return chars.toLocaleString("en-US") + " 字 · " + paras + " 段 · " + heads + " 个标题";
  }
  function render() {
    var md = input.value;
    if (window.MyonMarkdown) {
      preview.innerHTML = window.MyonMarkdown.render(md);
    } else {
      preview.textContent = md;
    }
    counts.textContent = stats(md);
  }
  function markDirty() {
    dirty = true;
    clearTimeout(stateTimer);
    setState("未保存的修改 · 前台仍显示上一份", true);
    setSource("来源：未保存的编辑");
  }

  function save() {
    var md = input.value;
    if (!md.trim()) {
      setState("内容为空 · 未保存 · 点「恢复默认」可回到默认内容", true);
      toast("内容为空 · 未保存");
      return;
    }
    if (!writeStore(md)) {
      setState("无法写入本机存储 · 请用本地服务器打开", true);
      toast("保存失败 · 本机存储不可用");
      return;
    }
    dirty = false;
    setState("已保存 · 首页封面将使用这份内容", true);
    setSource("来源：本机保存 · 刚刚");
    clearTimeout(saveTimer);
    saveBtn.textContent = "已保存";
    saveTimer = setTimeout(function () { saveBtn.textContent = "保存"; }, 3000);
    clearTimeout(stateTimer);
    stateTimer = setTimeout(function () {
      if (!dirty) {
        setState("来源：本机保存 · 前台已同步", false);
        setSource("来源：本机保存");
      }
    }, 3000);
    toast("已保存 · 首页封面将使用这份内容");
  }

  function resetDefault() {
    clearStore();
    input.value = DEF;
    dirty = false;
    preview.innerHTML = window.MyonMarkdown ? window.MyonMarkdown.render(DEF) : "";
    counts.textContent = stats(DEF);
    setSource("来源：默认内容");
    setState("已恢复默认 · 首页封面将使用默认内容", true);
    clearTimeout(resetTimer);
    resetBtn.textContent = "已恢复默认";
    resetTimer = setTimeout(function () { resetBtn.textContent = "恢复默认"; }, 3000);
    clearTimeout(stateTimer);
    stateTimer = setTimeout(function () {
      if (!dirty) setState("来源：默认内容 · 尚未保存", false);
    }, 3000);
    toast("已恢复默认内容");
    input.focus();
  }

  input.addEventListener("input", function () { markDirty(); render(); });
  saveBtn.addEventListener("click", save);
  resetBtn.addEventListener("click", resetDefault);
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      save();
    }
  });

  /* ---------- 初始化：本地有就载入本地，否则用默认 ---------- */
  var saved = readStore();
  if (saved !== null && saved.trim() !== "") {
    input.value = saved;
    render();
    setSource("来源：本机保存");
    setState("来源：本机保存 · 前台已同步", false);
  } else {
    input.value = DEF;
    render();
    setSource("来源：默认内容");
    setState("来源：默认内容 · 尚未保存", false);
  }
})();
