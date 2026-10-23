(function () {
  "use strict";

  /* ==========================================================================
     后台 · 工具：真实接口数据
     - GET    /api/v1/admin/tools       列表（按 position、id 升序）
     - POST   /api/v1/admin/tools       新建
     - PATCH  /api/v1/admin/tools/:id   编辑 / 启停
     - DELETE /api/v1/admin/tools/:id   删除
     令牌存在 localStorage['myon-admin-token']，请求时放 x-admin-token。
     slug 是前台工具页地址 /tools/<slug>，必填；重复时接口返回 409 slug_taken。
     启停与编辑都写 D1，前台 /tools 只读启用项。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var BUILTIN_LABEL = {
    ts: "时间戳转换",
    img: "图片压缩",
    md: "Markdown 预览",
    color: "配色生成",
    bgm: "追番时刻表",
    json: "JSON 格式化",
    redirect: "旧域名跳转",
    short: "短链接"
  };
  var HREF_RE = /^(\/|https?:\/\/)/;
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var FIELD_IDS = {
    slug: "fSlug",
    name: "fName",
    description: "fDesc",
    kind: "fKind",
    keywords: "fKeywords",
    toolKey: "fKey",
    href: "fHref",
    position: "fPosition"
  };
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  function $(id) {
    return document.getElementById(id);
  }
  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function fmtUpdated(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return pad2(d.getMonth() + 1) + "." + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function fmtFull(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return (
      d.getFullYear() +
      "." +
      pad2(d.getMonth() + 1) +
      "." +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  }
  function fmtRelative(ms) {
    if (!ms) return "—";
    var diff = Date.now() - ms;
    if (diff < 0) diff = 0;
    var minute = 60000;
    var hour = 3600000;
    var day = 86400000;
    if (diff < minute) return "刚刚";
    if (diff < hour) return Math.floor(diff / minute) + " 分钟前";
    if (diff < day) return Math.floor(diff / hour) + " 小时前";
    if (diff < 7 * day) return Math.floor(diff / day) + " 天前";
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + "." + pad2(d.getDate());
  }

  /* ---------------- 页面元素 ---------------- */
  var pageEl = document.querySelector(".page[data-api]");
  var API_URL = pageEl ? pageEl.getAttribute("data-api") || "" : "";

  var rowsEl = $("rows");
  var tblWrap = $("tblWrap");
  var listState = $("listState");
  var emptyEl = $("empty");
  var emptyText = $("emptyText");
  var emptyBtn = $("emptyBtn");
  var btnNewTool = $("btnNewTool");

  var mTotal = $("mTotal");
  var mEnabled = $("mEnabled");
  var mDisabled = $("mDisabled");
  var mUpdated = $("mUpdated");
  var mUpdatedNote = $("mUpdatedNote");
  var pTotal = $("pTotal");
  var pEnabled = $("pEnabled");
  var pUpdated = $("pUpdated");
  var enabledCount = $("enabledCount");
  var totalCount = $("totalCount");
  var secEn = $("secEn");

  var banner = $("tbanner");
  var bannerK = $("bannerK");
  var bannerTitle = $("bannerTitle");
  var bannerText = $("bannerText");
  var bannerIssues = $("bannerIssues");
  var bannerAction = $("bannerAction");
  var bannerRetry = $("bannerRetry");

  var toastEl = $("toast");

  var toolDlg = $("toolDlg");
  var toolForm = $("toolForm");
  var toolDlgTab = $("toolDlgTab");
  var toolDlgTitle = $("toolDlgTitle");
  var toolDlgState = $("toolDlgState");
  var formBanner = $("formBanner");
  var formBannerK = $("formBannerK");
  var formBannerTitle = $("formBannerTitle");
  var formBannerText = $("formBannerText");
  var formIssues = $("formIssues");
  var formHint = $("formHint");
  var formMeta = $("formMeta");
  var formSave = $("formSave");
  var formCancel = $("formCancel");
  var fName = $("fName");
  var fSlug = $("fSlug");
  var fDesc = $("fDesc");
  var fKind = $("fKind");
  var fKeywords = $("fKeywords");
  var fKey = $("fKey");
  var fHref = $("fHref");
  var fPosition = $("fPosition");
  var fEnabled = $("fEnabled");

  var delDlg = $("delDlg");
  var delTarget = $("delTarget");
  var delOk = $("delOk");
  var delCancel = $("delCancel");

  /* ---------------- 状态 ---------------- */
  var state = {
    items: [],
    total: 0,
    ready: false,
    loading: false,
    saving: false,
    editing: null,
    deleting: null
  };
  var emptyAction = null;

  /* ---------------- 提示条 ---------------- */
  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-on");
    }, 3200);
  }

  function fillIssueList(listEl, issues) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    if (!issues || !issues.length) {
      listEl.hidden = true;
      return;
    }
    each(issues, function (issue) {
      var li = document.createElement("li");
      li.textContent = (issue.path ? issue.path + "：" : "") + (issue.message || "校验未通过");
      listEl.appendChild(li);
    });
    listEl.hidden = false;
  }

  function resetBannerActions() {
    bannerAction.hidden = true;
    bannerRetry.hidden = true;
    bannerAction.onclick = null;
    bannerRetry.onclick = null;
    bannerAction.removeAttribute("href");
    bannerIssues.hidden = true;
  }

  function hideBanner() {
    banner.hidden = true;
    resetBannerActions();
  }

  function showBanner(tone, title, text, issues) {
    banner.hidden = false;
    each(NOTICE_TONES, function (name) {
      banner.classList.remove(name);
    });
    banner.classList.add("notice--" + tone);
    bannerK.textContent = tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO";
    bannerTitle.textContent = title;
    bannerText.textContent = text || "";
    bannerText.hidden = !text;
    fillIssueList(bannerIssues, issues || []);
    bannerAction.hidden = true;
    bannerRetry.hidden = true;
    bannerAction.onclick = null;
    bannerRetry.onclick = null;
    bannerAction.removeAttribute("href");
  }

  function bannerLink(label, href) {
    bannerAction.hidden = false;
    bannerAction.textContent = label;
    bannerAction.setAttribute("href", href);
  }

  function bannerRetryButton(label, fn) {
    bannerRetry.hidden = false;
    bannerRetry.textContent = label;
    bannerRetry.onclick = fn;
  }

  /* ---------------- 接口 ---------------- */
  function apiError(status, message) {
    var err = new Error(message || "request_failed");
    err.status = status || 0;
    return err;
  }

  function apiRequest(path, options) {
    var opts = options || {};
    var headers = { accept: "application/json" };
    var token = (readStore(TOKEN_KEY) || "").trim();
    if (token) headers["x-admin-token"] = token;
    var init = {
      method: opts.method || "GET",
      headers: headers,
      cache: "no-store"
    };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (!API_URL) return Promise.reject(apiError(0, "missing_api_url"));
    return fetch(API_URL + (path || ""), init).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (data) {
          return { res: res, data: data };
        });
    });
  }

  /* ---------------- 统计与空态 ---------------- */
  function isEnabled(value) {
    return value === true || value === 1;
  }

  function resetSummary() {
    mTotal.textContent = "—";
    mEnabled.textContent = "—";
    mDisabled.textContent = "—";
    mUpdated.textContent = "—";
    mUpdated.removeAttribute("title");
    mUpdatedNote.textContent = "所有工具的 updatedAt 取最大值";
    pTotal.textContent = "—";
    pEnabled.textContent = "—";
    pUpdated.textContent = "—";
    pUpdated.removeAttribute("title");
    enabledCount.textContent = "—";
    totalCount.textContent = "—";
    secEn.textContent = "TOOLS / —";
  }

  function renderSummary() {
    var total = typeof state.total === "number" ? state.total : state.items.length;
    var enabled = 0;
    var latest = 0;
    each(state.items, function (item) {
      if (isEnabled(item.enabled)) enabled += 1;
      var t = Date.parse(item.updatedAt || "");
      if (!isNaN(t) && t > latest) latest = t;
    });
    var disabled = Math.max(0, total - enabled);

    mTotal.textContent = String(total);
    mEnabled.textContent = String(enabled);
    mDisabled.textContent = String(disabled);
    if (latest) {
      mUpdated.textContent = fmtRelative(latest);
      mUpdated.title = fmtFull(new Date(latest).toISOString());
      mUpdatedNote.textContent = "最后更新于 " + fmtFull(new Date(latest).toISOString());
    } else {
      mUpdated.textContent = "—";
      mUpdated.removeAttribute("title");
      mUpdatedNote.textContent = "还没有更新记录 · 新建工具后显示";
    }
    pTotal.textContent = String(total);
    pEnabled.textContent = String(enabled);
    pUpdated.textContent = latest ? fmtRelative(latest) : "—";
    if (latest) pUpdated.title = fmtFull(new Date(latest).toISOString());
    else pUpdated.removeAttribute("title");
    enabledCount.textContent = String(enabled);
    totalCount.textContent = String(total);
    secEn.textContent = "TOOLS / " + pad2(total);
  }

  function setEmpty(text, actionLabel, fn) {
    emptyText.textContent = text;
    emptyBtn.textContent = actionLabel || "新增工具";
    emptyBtn.hidden = !actionLabel;
    emptyAction = fn || null;
    emptyEl.hidden = false;
    tblWrap.hidden = true;
    listState.hidden = true;
    resetSummary();
  }

  function clearEmpty() {
    emptyEl.hidden = true;
  }

  function setLoading(on, text) {
    state.loading = on;
    listState.hidden = !on;
    if (text) listState.textContent = text;
    if (on) {
      tblWrap.hidden = true;
      emptyEl.hidden = true;
      btnNewTool.disabled = true;
    }
  }

  /* ---------------- 加载 ---------------- */
  function handleNoToken() {
    state.ready = false;
    state.items = [];
    state.total = 0;
    setLoading(false);
    setEmpty("后台还没连上 · 需要管理令牌才能读写工具。", "去设置令牌", function () {
      location.href = "/admin/settings";
    });
    showBanner(
      "info",
      "尚未填写管理令牌",
      "在「设置 / 管理令牌」里填入本地令牌（dev-admin-token），保存后回到本页刷新。"
    );
    bannerLink("去设置令牌 →", "/admin/settings");
  }

  function handleLoadError(err) {
    state.ready = false;
    state.items = [];
    state.total = 0;
    setLoading(false);
    var status = err && err.status;
    if (status === 401) {
      setEmpty("管理令牌无效，读不到工具。", "去设置令牌", function () {
        location.href = "/admin/settings";
      });
      showBanner(
        "error",
        "管理令牌无效（401）",
        "令牌被拒绝。去「设置 / 管理令牌」更新后刷新本页；本地令牌通常是 dev-admin-token。"
      );
      bannerLink("去设置令牌 →", "/admin/settings");
      return;
    }
    if (status === 503) {
      setEmpty("服务端未配置 ADMIN_TOKEN，后台读不到工具。", "重试", function () {
        loadTools();
      });
      showBanner(
        "warn",
        "服务端未配置 ADMIN_TOKEN",
        "本地请在 apps/web/.dev.vars 里配置 ADMIN_TOKEN 后重启开发服务器。"
      );
      bannerRetryButton("重试", function () {
        loadTools();
      });
      return;
    }
    setEmpty("工具读取失败 · 网络或服务端异常。", "重试", function () {
      loadTools();
    });
    showBanner(
      "error",
      status ? "读取工具失败（HTTP " + status + "）" : "读取工具失败",
      "检查开发服务器是否在运行，或稍后重试；问题持续时查看 Worker 日志。"
    );
    bannerRetryButton("重试", function () {
      loadTools();
    });
  }

  function loadTools() {
    hideBanner();
    if (!API_URL) {
      handleLoadError(apiError(0, "页面缺少接口地址"));
      return;
    }
    var token = (readStore(TOKEN_KEY) || "").trim();
    if (!token) {
      handleNoToken();
      return;
    }
    setLoading(true, "正在读取工具…");
    apiRequest("")
      .then(function (result) {
        var status = result.res.status;
        if (status === 401) throw apiError(401);
        if (status === 503) throw apiError(503);
        if (!result.res.ok) throw apiError(status);
        var data = result.data || {};
        if (!Array.isArray(data.items)) throw apiError(0, "响应缺少 items");
        state.items = data.items;
        state.total = typeof data.total === "number" ? data.total : data.items.length;
        state.ready = true;
        setLoading(false);
        hideBanner();
        btnNewTool.disabled = false;
        renderAll();
      })
      .catch(function (err) {
        handleLoadError(err);
      });
  }

  /* ---------------- 渲染 ---------------- */
  function kindText(item) {
    if (item.kind) return item.kind;
    if (item.toolKey) return "内置工具 · " + (BUILTIN_LABEL[item.toolKey] || item.toolKey);
    if (item.href) return "自定义链接";
    return "未设置类型";
  }

  function buildRow(item, index) {
    var on = isEnabled(item.enabled);
    var tr = el("tr", "trow");
    tr.setAttribute("data-id", item.id || "");
    tr.setAttribute("data-on", String(on));
    if (!on) tr.classList.add("is-off");

    tr.appendChild(el("td", "c-no", pad2(index + 1)));

    var tdT = el("td", "c-t");
    tdT.appendChild(el("span", "t-name", item.name || "（未命名工具）"));
    tdT.appendChild(
      el("span", "t-slug", item.slug ? "/tools/" + item.slug : "未设置 slug")
    );
    var desc = el("span", "t-desc", item.description || "还没有写说明");
    desc.title = item.description || "";
    tdT.appendChild(desc);
    tr.appendChild(tdT);

    var tdKind = el("td", "c-kind");
    tdKind.appendChild(el("span", "kind-text", kindText(item)));
    tdKind.appendChild(el("span", "kind-meta", item.toolKey ? "内置 · " + item.toolKey : "自定义 · 链接"));
    if (item.kind) tdKind.title = item.kind;
    tr.appendChild(tdKind);

    var tdSw = el("td", "c-sw");
    var cell = el("span", "switch-cell");
    var sw = el("button", "switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("data-on", String(on));
    sw.setAttribute("aria-checked", String(on));
    sw.setAttribute("aria-label", (on ? "停用 " : "启用 ") + (item.name || "该工具"));
    var track = el("span", "track");
    track.appendChild(el("span", "knob"));
    sw.appendChild(track);
    cell.appendChild(sw);
    cell.appendChild(el("span", "switch-label", on ? "启用中" : "已停用"));
    tdSw.appendChild(cell);
    tr.appendChild(tdSw);

    var tdOps = el("td", "c-ops");
    var ops = el("div", "row-ops");
    // 前台工具页统一走 /tools/<slug>；自定义工具的 href 由工具页 302 跳转。
    var openHref = item.slug ? "/tools/" + item.slug : "/tools";
    var open = el("a", "op op--go", "打开");
    open.href = openHref;
    open.target = "_blank";
    open.rel = "noopener";
    open.title = "在新标签页打开 " + openHref;
    ops.appendChild(open);

    var editBtn = el("button", "op", "编辑");
    editBtn.type = "button";
    editBtn.setAttribute("data-op", "edit");
    editBtn.setAttribute("data-id", item.id || "");
    ops.appendChild(editBtn);

    var delBtn = el("button", "op op--danger", "删除");
    delBtn.type = "button";
    delBtn.setAttribute("data-op", "del");
    delBtn.setAttribute("data-id", item.id || "");
    ops.appendChild(delBtn);

    tdOps.appendChild(ops);
    tr.appendChild(tdOps);
    return tr;
  }

  function renderRows() {
    while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
    var frag = document.createDocumentFragment();
    each(state.items, function (item, index) {
      frag.appendChild(buildRow(item, index));
    });
    rowsEl.appendChild(frag);
  }

  function renderAll() {
    renderSummary();
    renderRows();
    if (state.items.length === 0) {
      clearEmpty();
      emptyText.textContent = "还没有工具。新增第一个后，前台 /tools 会读到同一份数据。";
      emptyBtn.textContent = "新增工具";
      emptyBtn.hidden = false;
      emptyAction = function () {
        openForm(null);
      };
      emptyEl.hidden = false;
      tblWrap.hidden = true;
      listState.hidden = true;
      return;
    }
    clearEmpty();
    tblWrap.hidden = false;
    listState.hidden = true;
  }

  function findItem(id) {
    var found = null;
    each(state.items, function (item) {
      if (item.id === id) found = item;
    });
    return found;
  }

  function replaceItem(item) {
    if (!item || !item.id) return;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === item.id) {
        state.items[i] = item;
        return;
      }
    }
  }

  /* ---------------- 启停 ---------------- */
  function handleWriteError(result, label) {
    var status = result.res.status;
    if (status === 401) {
      showBanner(
        "error",
        label + "失败 · 管理令牌无效（401）",
        "去「设置 / 管理令牌」更新令牌后再试；本地令牌通常是 dev-admin-token。"
      );
      bannerLink("去设置令牌 →", "/admin/settings");
      toast(label + "失败 · 令牌无效");
      return;
    }
    if (status === 503) {
      showBanner(
        "warn",
        label + "失败 · 服务端未配置 ADMIN_TOKEN",
        "本地请在 apps/web/.dev.vars 里配置 ADMIN_TOKEN 后重启开发服务器。"
      );
      toast(label + "失败 · 服务端未配置 ADMIN_TOKEN");
      return;
    }
    toast(label + "失败 · HTTP " + status);
  }

  function toggleEnabled(item, sw) {
    if (!item || sw.disabled) return;
    sw.disabled = true;
    apiRequest("/" + encodeURIComponent(item.id), { method: "PATCH", body: { enabled: !isEnabled(item.enabled) } })
      .then(function (result) {
        if (result.res.ok && result.data && result.data.item) {
          replaceItem(result.data.item);
          renderAll();
          toast(
            (item.enabled ? "已停用「" : "已启用「") +
              (item.name || "工具") +
              "」" +
              (item.enabled ? " · 前台入口已收起" : " · 前台入口已恢复")
          );
          return;
        }
        if (result.res.status === 404) {
          toast("工具已不存在 · 正在刷新列表");
          loadTools();
          return;
        }
        handleWriteError(result, "切换状态");
      })
      .catch(function () {
        toast("切换失败 · 请检查网络或服务");
      })
      .then(function () {
        sw.disabled = false;
      });
  }

  /* ---------------- 新建 / 编辑 ---------------- */
  function hideFormBanner() {
    formBanner.hidden = true;
    formIssues.hidden = true;
  }

  function showFormBanner(tone, title, text, issues) {
    formBanner.hidden = false;
    formBanner.setAttribute("data-tone", tone === "warn" ? "warn" : "error");
    formBannerK.textContent = tone === "warn" ? "WARN" : "ERR";
    formBannerTitle.textContent = title;
    formBannerText.textContent = text || "";
    formBannerText.hidden = !text;
    fillIssueList(formIssues, issues || []);
  }

  function clearFieldMarks() {
    each(document.querySelectorAll(".tool-fields .tf.is-invalid"), function (tf) {
      tf.classList.remove("is-invalid");
    });
  }

  function markFields(paths) {
    clearFieldMarks();
    each(paths || [], function (path) {
      var id = FIELD_IDS[path];
      if (!id) return;
      var input = $(id);
      var tf = input && input.closest(".tf");
      if (tf) tf.classList.add("is-invalid");
    });
  }

  function focusFirstIssue(issues) {
    if (!issues || !issues.length) return;
    for (var i = 0; i < issues.length; i++) {
      var id = FIELD_IDS[issues[i].path];
      if (id && $(id)) {
        $(id).focus();
        return;
      }
    }
    fName.focus();
  }

  function syncFormHint() {
    var key = fKey.value;
    if (key) {
      formHint.textContent = "内置工具「" + (BUILTIN_LABEL[key] || key) + "」· 链接可留空";
      fHref.placeholder = "可留空；也可填 / 或 http(s) 开头的链接";
    } else {
      formHint.textContent = "「自定义链接」需要填链接：/ 开头或 http(s):// 开头。";
      fHref.placeholder = "/tools 或 https://…";
    }
  }

  function setFormBusy(on) {
    state.saving = on;
    formSave.disabled = on;
    formCancel.disabled = on;
    fKey.disabled = on;
    fSlug.disabled = on;
    if (on) {
      formSave.textContent = state.editing ? "保存中…" : "创建中…";
    } else {
      formSave.textContent = state.editing ? "保存修改" : "创建工具";
    }
  }

  function openForm(item) {
    state.editing = item || null;
    hideFormBanner();
    clearFieldMarks();
    toolForm.reset();
    fPosition.value = "0";
    fEnabled.checked = true;
    fKey.value = "";

    if (item) {
      fName.value = item.name || "";
      fSlug.value = item.slug || "";
      fDesc.value = item.description || "";
      fKind.value = item.kind || "";
      fKeywords.value = item.keywords || "";
      if (item.toolKey && BUILTIN_LABEL[item.toolKey]) fKey.value = item.toolKey;
      fHref.value = item.href || "";
      fPosition.value = String(typeof item.position === "number" ? item.position : 0);
      fEnabled.checked = isEnabled(item.enabled);
      toolDlgTab.textContent = "TOOL / 编辑";
      toolDlgTitle.textContent = "编辑工具";
      toolDlgState.textContent = "更新于 " + fmtUpdated(item.updatedAt);
      formMeta.textContent = "工具 ID · " + (item.id || "—");
    } else {
      toolDlgTab.textContent = "TOOL / 新增";
      toolDlgTitle.textContent = "新增工具";
      toolDlgState.textContent = "未保存";
      formMeta.textContent = "保存后立即写入 D1";
    }
    setFormBusy(false);
    syncFormHint();
    if (typeof toolDlg.showModal === "function") toolDlg.showModal();
    fName.focus();
  }

  function closeForm(force) {
    if (state.saving && !force) return;
    if (typeof toolDlg.close === "function") toolDlg.close();
    state.editing = null;
  }

  function collectForm() {
    var rawPosition = fPosition.value.trim();
    var position = rawPosition === "" ? 0 : Number(rawPosition);
    return {
      slug: fSlug.value.trim(),
      name: fName.value.trim(),
      description: fDesc.value.trim(),
      kind: fKind.value.trim(),
      keywords: fKeywords.value.trim(),
      toolKey: fKey.value || null,
      href: fHref.value.trim() || null,
      enabled: fEnabled.checked,
      position: position
    };
  }

  function validateForm(data) {
    var issues = [];
    if (!data.slug) issues.push({ path: "slug", message: "slug 不能为空" });
    else if (data.slug.length < 2 || data.slug.length > 40) {
      issues.push({ path: "slug", message: "slug 需要 2–40 个字符" });
    } else if (!SLUG_RE.test(data.slug)) {
      issues.push({ path: "slug", message: "slug 只能用小写字母、数字和连字符" });
    }
    if (!data.name) issues.push({ path: "name", message: "名称不能为空" });
    else if (data.name.length > 60) issues.push({ path: "name", message: "名称最多 60 个字符" });
    if (data.description.length > 200) issues.push({ path: "description", message: "说明最多 200 个字符" });
    if (data.kind.length > 80) issues.push({ path: "kind", message: "类型最多 80 个字符" });
    if (data.keywords.length > 200) issues.push({ path: "keywords", message: "关键词最多 200 个字符" });
    if (data.href && data.href.length > 300) issues.push({ path: "href", message: "链接最多 300 个字符" });
    else if (data.href && !HREF_RE.test(data.href)) {
      issues.push({ path: "href", message: "链接需要以 / 或 http(s):// 开头" });
    }
    if (!data.toolKey && !data.href) {
      issues.push({ path: "href", message: "自定义工具需要填写链接" });
    }
    if (!isFinite(data.position) || Math.floor(data.position) !== data.position) {
      issues.push({ path: "position", message: "排序需要是整数" });
    } else if (data.position < 0 || data.position > 9999) {
      issues.push({ path: "position", message: "排序范围是 0–9999" });
    }
    return issues;
  }

  function submitForm(e) {
    e.preventDefault();
    if (state.saving) return;
    var data = collectForm();
    var issues = validateForm(data);
    clearFieldMarks();
    if (issues.length) {
      showFormBanner("error", "字段还没填对", "按下面提示修改后再保存：", issues);
      markFields(
        issues.map(function (issue) {
          return issue.path;
        })
      );
      focusFirstIssue(issues);
      return;
    }

    var editing = state.editing;
    var path = editing ? "/" + encodeURIComponent(editing.id) : "";
    setFormBusy(true);
    hideFormBanner();

    apiRequest(path, { method: editing ? "PATCH" : "POST", body: data })
      .then(function (result) {
        if (result.res.ok && result.data && result.data.item) {
          var item = result.data.item;
          closeForm(true);
          toast((editing ? "已保存「" : "已创建「") + (item.name || data.name) + "」");
          loadTools();
          return;
        }
        if (result.res.status === 409) {
          showFormBanner(
            "error",
            "保存失败 · slug 已被占用",
            "换一个地址再保存：「" + data.slug + "」已经属于别的工具。",
            [{ path: "slug", message: "slug 已被占用" }]
          );
          markFields(["slug"]);
          fSlug.focus();
          return;
        }
        if (result.res.status === 400) {
          var serverIssues = (result.data && result.data.issues) || [];
          showFormBanner("error", "保存失败 · 字段校验未通过", "修正下列字段后重新保存：", serverIssues);
          markFields(
            serverIssues.map(function (issue) {
              return issue.path;
            })
          );
          focusFirstIssue(serverIssues);
          return;
        }
        if (result.res.status === 401) {
          showFormBanner(
            "error",
            "保存失败 · 管理令牌无效（401）",
            "去「设置 / 管理令牌」更新令牌后重试；本地令牌通常是 dev-admin-token。"
          );
          return;
        }
        if (result.res.status === 503) {
          showFormBanner(
            "warn",
            "保存失败 · 服务端未配置 ADMIN_TOKEN",
            "本地请在 apps/web/.dev.vars 里配置 ADMIN_TOKEN 后重启开发服务器。"
          );
          return;
        }
        showFormBanner(
          "error",
          "保存失败（HTTP " + result.res.status + "）",
          "服务端返回异常，稍后重试；问题持续时查看 Worker 日志。"
        );
      })
      .catch(function () {
        showFormBanner("error", "保存失败 · 网络异常", "检查开发服务器是否在运行，或稍后重试。");
      })
      .then(function () {
        setFormBusy(false);
      });
  }

  /* ---------------- 删除 ---------------- */
  function openDelete(item) {
    state.deleting = item;
    var meta = "自定义工具";
    if (item.toolKey) meta = "内置 · " + item.toolKey;
    else if (item.href) meta = "自定义 · " + item.href;
    delTarget.textContent =
      "「" + (item.name || "未命名工具") + "」 · " + meta +
      " · " + (item.slug ? "/tools/" + item.slug : "未设置 slug") +
      " · " + (isEnabled(item.enabled) ? "启用中" : "已停用");
    delOk.disabled = false;
    delOk.textContent = "删除";
    if (typeof delDlg.showModal === "function") delDlg.showModal();
  }

  function closeDelete() {
    if (typeof delDlg.close === "function") delDlg.close();
    state.deleting = null;
  }

  function confirmDelete() {
    var item = state.deleting;
    if (!item || delOk.disabled) return;
    delOk.disabled = true;
    delOk.textContent = "删除中…";
    apiRequest("/" + encodeURIComponent(item.id), { method: "DELETE" })
      .then(function (result) {
        if (result.res.ok) {
          closeDelete();
          toast("已删除「" + (item.name || "工具") + "」");
          loadTools();
          return;
        }
        if (result.res.status === 404) {
          closeDelete();
          toast("工具已不存在 · 正在刷新列表");
          loadTools();
          return;
        }
        closeDelete();
        handleWriteError(result, "删除");
      })
      .catch(function () {
        closeDelete();
        showBanner("error", "删除失败 · 网络异常", "检查开发服务器是否在运行，或稍后重试。");
        bannerRetryButton("重试", function () {
          loadTools();
        });
        toast("删除失败 · 请检查网络或服务");
      });
  }

  /* ---------------- 事件绑定 ---------------- */
  rowsEl.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var opBtn = target.closest("[data-op]");
    if (opBtn) {
      var id = opBtn.getAttribute("data-id");
      var item = findItem(id);
      if (!item) return;
      var op = opBtn.getAttribute("data-op");
      if (op === "edit") openForm(item);
      else if (op === "del") openDelete(item);
      return;
    }
    var sw = target.closest(".switch");
    if (!sw) return;
    var row = sw.closest(".trow");
    if (!row) return;
    var rowItem = findItem(row.getAttribute("data-id"));
    if (rowItem) toggleEnabled(rowItem, sw);
  });

  btnNewTool.addEventListener("click", function () {
    if (!state.ready) {
      toast("还没连上后台 · 先填写管理令牌");
      return;
    }
    openForm(null);
  });
  emptyBtn.addEventListener("click", function () {
    if (emptyAction) emptyAction();
  });

  toolForm.addEventListener("submit", submitForm);
  formCancel.addEventListener("click", function () {
    closeForm(false);
  });
  toolDlg.addEventListener("click", function (e) {
    if (e.target === toolDlg) closeForm(false);
  });
  toolDlg.addEventListener("close", function () {
    if (!state.saving) state.editing = null;
  });
  fKey.addEventListener("change", function () {
    syncFormHint();
    clearFieldMarks();
  });
  fHref.addEventListener("input", function () {
    clearFieldMarks();
  });
  fSlug.addEventListener("input", function () {
    clearFieldMarks();
  });

  delCancel.addEventListener("click", closeDelete);
  delOk.addEventListener("click", confirmDelete);
  delDlg.addEventListener("click", function (e) {
    if (e.target === delDlg) closeDelete();
  });
  delDlg.addEventListener("close", function () {
    state.deleting = null;
  });

  /* ---------------- 初始化 ---------------- */
  resetSummary();
  loadTools();
})();
