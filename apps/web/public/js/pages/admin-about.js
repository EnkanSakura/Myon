(function () {
  "use strict";

  /* ==========================================================================
     后台 · 关于 / README
     - GET  /api/v1/about         公开读取 markdown / updatedAt
     - PUT  /api/v1/admin/about   保存 markdown（需要顶栏的「管理令牌」）
     预览由本地 markdown.js 渲染，保存成功才代表前台会更新。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";

  var pageEl = document.querySelector(".page[data-api]");
  var SAVE_API = pageEl ? pageEl.getAttribute("data-api") || "" : "";
  var READ_API = pageEl ? pageEl.getAttribute("data-read-api") || "" : "";

  var input = document.getElementById("mdInput");
  var preview = document.getElementById("mdPreview");
  var counts = document.getElementById("mdCounts");
  var sourceTag = document.getElementById("sourceTag");
  var saveState = document.getElementById("saveState");
  var saveBtn = document.getElementById("saveBtn");
  var reloadBtn = document.getElementById("reloadBtn");
  var toastEl = document.getElementById("toast");
  var banner = document.getElementById("abBanner");
  var bannerK = document.getElementById("abBannerK");
  var bannerTitle = document.getElementById("abBannerTitle");
  var bannerText = document.getElementById("abBannerText");
  var tokenBtn = document.getElementById("abToken");
  var retryBtn = document.getElementById("abRetry");

  var dirty = false;
  var saving = false;
  var loaded = false;
  var updatedAt = null;
  var toastTimer = null;

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function timeNow() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function stamp(value) {
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return date.getFullYear() + "." + pad2(date.getMonth() + 1) + "." + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
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

  function setNotice(tone, title, text, options) {
    var opts = options || {};
    banner.hidden = false;
    banner.classList.remove("notice--info", "notice--warn", "notice--ok", "notice--error");
    banner.classList.add("notice--" + tone);
    bannerK.textContent = tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO";
    bannerTitle.textContent = title;
    bannerText.textContent = text || "";
    bannerText.hidden = !text;
    tokenBtn.hidden = !opts.token;
    retryBtn.hidden = !opts.retry;
  }
  function hideNotice() {
    banner.hidden = true;
    tokenBtn.hidden = true;
    retryBtn.hidden = true;
  }

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

  function setEditable(on) {
    input.disabled = !on;
    reloadBtn.disabled = false;
    saveBtn.disabled = !on || saving;
  }

  function markDirty() {
    if (!loaded) return;
    dirty = true;
    setState("有未保存的修改", true);
    setSource("来源：未保存的编辑");
  }

  /** 读取服务端的当前版本；成功后清掉未保存状态。 */
  function load() {
    if (!READ_API) {
      setNotice("error", "页面缺少关于接口地址", "这是页面配置问题，请联系站点维护者。", { retry: false });
      setState("读取失败 · 缺少接口地址", true);
      return;
    }
    loaded = false;
    dirty = false;
    setEditable(false);
    hideNotice();
    setState("读取中…", false);
    setSource("来源：读取中…");
    fetch(READ_API, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok) throw new Error("HTTP " + result.status);
        var markdown = result.body && typeof result.body.markdown === "string" ? result.body.markdown : "";
        input.value = markdown;
        updatedAt = result.body && result.body.updatedAt ? result.body.updatedAt : null;
        loaded = true;
        setEditable(true);
        render();
        setState("已读取 · " + timeNow(), false);
        setSource(updatedAt ? "来源：服务端 · 更新于 " + stamp(updatedAt) : "来源：服务端 · 还没有内容");
      })
      .catch(function (error) {
        setState("读取失败", true);
        setSource("来源：读取失败");
        setNotice(
          "error",
          "读取关于页失败",
          (error && error.message ? error.message : "网络或服务端异常") + " · 稍后重试。",
          { retry: true }
        );
      });
  }

  function save() {
    if (!loaded || saving) return;
    var token = (readStore(TOKEN_KEY) || "").trim();
    if (!token) {
      setNotice("info", "尚未连接后台", "点右上角「管理令牌」填入令牌后保存，再回来写入关于页。", { token: true });
      toast("需要管理令牌");
      return;
    }
    if (!SAVE_API) {
      setNotice("error", "页面缺少保存接口地址", "这是页面配置问题，请联系站点维护者。", {});
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    setState("保存中…", false);
    hideNotice();

    fetch(SAVE_API, {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-admin-token": token
      },
      cache: "no-store",
      body: JSON.stringify({ markdown: input.value })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) {
          setNotice("error", "保存失败 · 管理令牌无效", "请在右上角「管理令牌」里更新令牌后重试。", { token: true });
          setState("未保存 · 令牌无效", true);
          toast("保存失败 · 令牌无效");
          return;
        }
        if (result.status === 503) {
          setNotice("warn", "保存失败 · 服务端未配置管理令牌", "联系站点管理员配置后重新加载页面。", {});
          setState("未保存 · 服务端只读", true);
          toast("保存失败 · 服务端只读");
          return;
        }
        if (result.status === 400) {
          var issues = result.body && result.body.issues ? result.body.issues : [];
          setNotice(
            "error",
            "保存失败 · 内容校验未通过",
            issues.length ? issues[0].path + "：" + issues[0].message : "检查 Markdown 内容后重试。",
            {}
          );
          setState("未保存 · 内容校验未通过", true);
          toast("保存失败 · 校验未通过");
          return;
        }
        if (!result.ok) throw new Error("HTTP " + result.status);
        var item = result.body && result.body.item ? result.body.item : result.body;
        if (item && typeof item.markdown === "string" && item.markdown !== input.value) {
          input.value = item.markdown;
          render();
        }
        updatedAt = item && item.updatedAt ? item.updatedAt : new Date().toISOString();
        dirty = false;
        setState("已保存 · " + timeNow(), false);
        setSource(updatedAt ? "来源：服务端 · 更新于 " + stamp(updatedAt) : "来源：服务端");
        hideNotice();
        toast("关于页已保存 · 前台首页将使用这份内容");
      })
      .catch(function (error) {
        setNotice("error", "保存失败", (error && error.message ? error.message : "网络或服务端异常") + " · 修改还在编辑区，可以重试。", { retry: false });
        setState("保存失败 · 修改未写入", true);
        toast("保存失败 · 修改还在编辑区");
      })
      .then(function () {
        saving = false;
        saveBtn.textContent = "保存";
        saveBtn.disabled = !loaded;
      });
  }

  function reload() {
    if (dirty && !window.confirm("重新读取会丢弃未保存的修改，继续？")) return;
    load();
  }

  input.addEventListener("input", function () {
    markDirty();
    render();
  });
  saveBtn.addEventListener("click", save);
  reloadBtn.addEventListener("click", reload);
  retryBtn.addEventListener("click", load);
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S")) {
      event.preventDefault();
      save();
    }
  });

  render();
  load();
})();
