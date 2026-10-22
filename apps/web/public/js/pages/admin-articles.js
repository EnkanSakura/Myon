(function () {
  "use strict";

  /* ==========================================================================
     后台 · 文章台账：真实接口数据
     - GET    /api/v1/admin/posts?limit=20&offset=N   服务端分页（URL 用 ?page=N）
     - POST   /api/v1/admin/posts                     新建
     - PATCH  /api/v1/admin/posts/:id                 编辑 / 发布 / 转草稿
     - DELETE /api/v1/admin/posts/:id                 删除
     令牌存在 localStorage['myon-admin-token']，请求时放 x-admin-token。
     列表用接口分页；筛选与搜索只作用于当前页（页面上有说明）。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var PAGE_SIZE = 20;
  var STATUS_LABEL = { published: "已发布", draft: "草稿", archived: "归档" };
  var FIELD_IDS = {
    title: "fTitle",
    slug: "fSlug",
    category: "fCategory",
    status: "fStatus",
    excerpt: "fExcerpt",
    bodyMd: "fBody"
  };

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
  function fmtNumber(n) {
    return Number(n || 0).toLocaleString("en-US");
  }
  function fmtUpdated(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return pad2(d.getMonth() + 1) + "." + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function charCount(markdown) {
    return String(markdown || "").replace(/\s/g, "").length;
  }
  function readingMinutes(post) {
    var minutes = post && post.readingMinutes;
    if (typeof minutes === "number" && minutes > 0) return minutes;
    return Math.max(1, Math.ceil(charCount(post && post.bodyMd) / 400));
  }
  function statusLabel(status) {
    return STATUS_LABEL[status] || status || "—";
  }
  function isPublished(post) {
    return post && post.status === "published";
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
  var pager = $("pager");
  var pgNow = $("pgNow");
  var pgCount = $("pgCount");
  var pgTotal = $("pgTotal");
  var pgNums = $("pgNums");
  var pgPrev = $("pgPrev");
  var pgNext = $("pgNext");

  var sumAll = $("sumAll");
  var sumShown = $("sumShown");
  var sumUpdated = $("sumUpdated");

  var qInput = $("q");
  var catSel = $("catSel");
  var sortSel = $("sortSel");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab2"));

  var banner = $("listBanner");
  var bannerK = $("bannerK");
  var bannerTitle = $("bannerTitle");
  var bannerText = $("bannerText");
  var bannerIssues = $("bannerIssues");
  var bannerAction = $("bannerAction");
  var bannerRetry = $("bannerRetry");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  var toastEl = $("toast");
  var btnNew = $("btnNew");
  var btnImport = $("btnImport");
  var btnExport = $("btnExport");
  var mdInput = $("mdInput");

  var postDlg = $("postDlg");
  var postForm = $("postForm");
  var postDlgNo = $("postDlgNo");
  var postDlgTitle = $("postDlgTitle");
  var postDlgState = $("postDlgState");
  var formBanner = $("formBanner");
  var formBannerK = $("formBannerK");
  var formBannerTitle = $("formBannerTitle");
  var formBannerText = $("formBannerText");
  var formIssues = $("formIssues");
  var fTitle = $("fTitle");
  var fSlug = $("fSlug");
  var fCategory = $("fCategory");
  var fStatus = $("fStatus");
  var fExcerpt = $("fExcerpt");
  var fBody = $("fBody");
  var bodyHint = $("bodyHint");
  var postMeta = $("postMeta");
  var formSave = $("formSave");
  var formCancel = $("formCancel");
  var catList = $("catList");

  var delDlg = $("delDlg");
  var delTarget = $("delTarget");
  var delOk = $("delOk");
  var delCancel = $("delCancel");

  /* ---------------- 状态 ---------------- */
  var state = {
    posts: [], // 当前页的文章
    total: 0,
    page: 1,
    loading: false,
    saving: false,
    editing: null,
    deleting: null,
    status: "all",
    category: "all",
    q: "",
    sort: "update"
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

  function hideBanner() {
    banner.hidden = true;
    bannerAction.hidden = true;
    bannerRetry.hidden = true;
    bannerAction.onclick = null;
    bannerRetry.onclick = null;
    bannerIssues.hidden = true;
    bannerAction.removeAttribute("href");
  }

  function setNoticeTone(tone) {
    each(NOTICE_TONES, function (name) { banner.classList.remove(name); });
    banner.classList.add("notice--" + tone);
  }

  function showBanner(tone, title, text, issues) {
    banner.hidden = false;
    setNoticeTone(tone);
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
  function apiError(status, data, message) {
    var err = new Error(message || "request_failed");
    err.status = status || 0;
    err.data = data || null;
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
    if (!API_URL) return Promise.reject(apiError(0, null, "missing_api_url"));
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

  function readPageParam() {
    try {
      var raw = new URLSearchParams(location.search).get("page");
      var page = parseInt(raw || "1", 10);
      return isNaN(page) || page < 1 ? 1 : page;
    } catch (e) {
      return 1;
    }
  }

  function writePageParam(page) {
    try {
      var url = new URL(location.href);
      if (page <= 1) url.searchParams.delete("page");
      else url.searchParams.set("page", String(page));
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  function totalPages() {
    return Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  }

  /* ---------------- 加载与状态 ---------------- */
  function setLoading(on, text) {
    state.loading = on;
    listState.hidden = !on;
    if (text) listState.textContent = text;
    if (on) {
      tblWrap.hidden = true;
      emptyEl.hidden = true;
      pager.hidden = true;
      while (pgNums.firstChild) pgNums.removeChild(pgNums.firstChild);
    }
  }

  function setEmpty(text, actionLabel, fn) {
    emptyText.textContent = text;
    emptyBtn.textContent = actionLabel || "清除筛选";
    emptyBtn.hidden = !actionLabel;
    emptyAction = fn || null;
    emptyEl.hidden = false;
    tblWrap.hidden = true;
    pager.hidden = true;
    listState.hidden = true;
  }

  function hideEmpty() {
    emptyEl.hidden = true;
  }

  function resetCounts() {
    sumAll.textContent = "—";
    sumShown.textContent = "—";
    sumUpdated.textContent = "—";
  }

  function handleNoToken() {
    state.loading = false;
    setLoading(false);
    resetCounts();
    showBanner(
      "info",
      "尚未填写管理令牌",
      "在「设置 / 管理令牌」里填入本地令牌（dev-admin-token），保存后回到本页刷新。"
    );
    bannerLink("去设置令牌 →", "/admin/settings");
    setEmpty("后台还没连上 · 需要管理令牌才能读写文章。", "去设置令牌", function () {
      location.href = "/admin/settings";
    });
  }

  function handleLoadError(err) {
    state.loading = false;
    setLoading(false);
    resetCounts();
    var status = err && err.status;
    if (status === 401) {
      showBanner(
        "error",
        "管理令牌无效（401）",
        "令牌被拒绝。去「设置 / 管理令牌」更新后刷新本页；本地令牌通常是 dev-admin-token。"
      );
      bannerLink("去设置令牌 →", "/admin/settings");
      setEmpty("管理令牌无效，读不到文章。", "去设置令牌", function () {
        location.href = "/admin/settings";
      });
      return;
    }
    if (status === 503) {
      showBanner(
        "warn",
        "服务端未配置 ADMIN_TOKEN",
        "本地请在 apps/web/.dev.vars 里配置 ADMIN_TOKEN 后重启开发服务器。"
      );
      setEmpty("服务端未配置 ADMIN_TOKEN，后台只读。", "重试", function () {
        loadPage(state.page);
      });
      return;
    }
    showBanner(
      "error",
      status ? "读取文章失败（HTTP " + status + "）" : "读取文章失败",
      "检查开发服务器是否在运行，或稍后重试；问题持续时查看 Worker 日志。"
    );
    bannerRetryButton("重试", function () {
      loadPage(state.page);
    });
    setEmpty("文章读取失败 · 网络或服务端异常。", "重试", function () {
      loadPage(state.page);
    });
  }

  function loadPage(page) {
    hideBanner();
    if (!API_URL) {
      handleLoadError(apiError(0, null, "页面缺少接口地址"));
      return;
    }
    var token = (readStore(TOKEN_KEY) || "").trim();
    if (!token) {
      handleNoToken();
      return;
    }
    var target = Math.max(1, parseInt(page, 10) || 1);
    var offset = (target - 1) * PAGE_SIZE;
    setLoading(true, target > 1 ? "正在读取第 " + target + " 页…" : "正在读取文章…");
    apiRequest("?limit=" + PAGE_SIZE + "&offset=" + offset)
      .then(function (result) {
        var status = result.res.status;
        if (status === 401) throw apiError(401, result.data);
        if (status === 503) throw apiError(503, result.data);
        if (!result.res.ok) throw apiError(status, result.data);
        var data = result.data || {};
        if (!Array.isArray(data.items)) throw apiError(0, data, "响应缺少 items");
        state.posts = data.items;
        state.total = typeof data.total === "number" ? data.total : data.items.length;
        state.page = target;
        if (state.posts.length === 0 && state.total > 0 && target > 1) {
          loadPage(totalPages());
          return;
        }
        writePageParam(target);
        setLoading(false);
        renderAll();
      })
      .catch(function (err) {
        handleLoadError(err);
      });
  }

  /* ---------------- 渲染 ---------------- */
  function renderCounts() {
    var latest = "";
    each(state.posts, function (post) {
      if (post.updatedAt && post.updatedAt > latest) latest = post.updatedAt;
    });
    sumAll.textContent = String(state.total);
    sumShown.textContent = String(state.posts.length);
    sumUpdated.textContent = latest ? fmtUpdated(latest) : "—";
  }

  function renderCategoryOptions() {
    var seen = {};
    var cats = [];
    each(state.posts, function (post) {
      var cat = post.category || "";
      if (!cat || seen[cat]) return;
      seen[cat] = true;
      cats.push(cat);
    });
    cats.sort(function (a, b) {
      return a.localeCompare(b, "zh-Hans-CN");
    });
    var keep = state.category;
    while (catSel.firstChild) catSel.removeChild(catSel.firstChild);
    catSel.appendChild(new Option("全部分类", "all"));
    each(cats, function (cat) {
      catSel.appendChild(new Option(cat, cat));
    });
    catSel.value = keep !== "all" && seen[keep] ? keep : "all";
    state.category = catSel.value;

    while (catList.firstChild) catList.removeChild(catList.firstChild);
    each(cats, function (cat) {
      catList.appendChild(new Option(cat, cat));
    });
  }

  function filteredPosts() {
    var keyword = state.q.trim().toLowerCase();
    var list = state.posts.filter(function (post) {
      if (state.status !== "all" && post.status !== state.status) return false;
      if (state.category !== "all" && post.category !== state.category) return false;
      if (keyword) {
        var hay = (String(post.title || "") + " " + String(post.slug || "")).toLowerCase();
        if (hay.indexOf(keyword) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (state.sort === "title") {
        return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    return list;
  }

  function buildRow(post) {
    var tr = document.createElement("tr");
    tr.setAttribute("data-id", post.id);

    var tdTitle = el("td", "c-t");
    if (isPublished(post)) {
      var link = el("a", null, post.title || "（无标题）");
      link.href = "/articles/" + encodeURIComponent(post.slug || "");
      link.target = "_blank";
      link.rel = "noopener";
      tdTitle.appendChild(link);
    } else {
      var span = el("span", "tlink", post.title || "（无标题）");
      span.title = statusLabel(post.status) + " · 只有你自己能看到";
      tdTitle.appendChild(span);
    }

    var tdSlug = el("td", "c-slug", post.slug || "");
    tdSlug.title = post.slug || "";

    var tdCat = el("td", "c-cat");
    tdCat.appendChild(el("span", "tag tag--dark", post.category || "未分类"));

    var tdStatus = el("td");
    var st = el("span", "st");
    var sq = el("i", "sq" + (post.status === "draft" ? " sq--hollow" : post.status === "archived" ? " sq--arch" : ""));
    sq.setAttribute("aria-hidden", "true");
    st.appendChild(sq);
    st.appendChild(document.createTextNode(statusLabel(post.status)));
    tdStatus.appendChild(st);

    var tdTime = el("td", "c-time", fmtUpdated(post.updatedAt));
    tdTime.title = post.updatedAt || "";

    var tdRead = el("td", "c-read");
    tdRead.title = fmtNumber(charCount(post.bodyMd)) + " 字 · 约 " + readingMinutes(post) + " 分钟";
    tdRead.appendChild(el("b", null, fmtNumber(charCount(post.bodyMd))));
    tdRead.appendChild(document.createTextNode(" 字 · "));
    tdRead.appendChild(el("span", null, readingMinutes(post) + " 分钟"));

    var tdOps = el("td", "c-ops");
    var ops = el("div", "row-ops");
    var editBtn = el("button", "op", post.status === "draft" ? "继续写" : "编辑");
    editBtn.type = "button";
    editBtn.setAttribute("data-op", "edit");
    editBtn.setAttribute("data-id", post.id);
    var toggleBtn = el("button", "op", post.status === "published" ? "转为草稿" : "发布");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("data-op", "toggle");
    toggleBtn.setAttribute("data-id", post.id);
    var delBtn = el("button", "op op--danger", "删除");
    delBtn.type = "button";
    delBtn.setAttribute("data-op", "del");
    delBtn.setAttribute("data-id", post.id);
    ops.appendChild(editBtn);
    ops.appendChild(toggleBtn);
    ops.appendChild(delBtn);
    tdOps.appendChild(ops);

    tr.appendChild(tdTitle);
    tr.appendChild(tdSlug);
    tr.appendChild(tdCat);
    tr.appendChild(tdStatus);
    tr.appendChild(tdTime);
    tr.appendChild(tdRead);
    tr.appendChild(tdOps);
    return tr;
  }

  function renderRows(list) {
    while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
    var frag = document.createDocumentFragment();
    each(list, function (post) {
      frag.appendChild(buildRow(post));
    });
    rowsEl.appendChild(frag);
  }

  function pageNumbers(current, total) {
    var out = [];
    for (var i = 1; i <= total; i++) {
      if (total <= 8 || i === 1 || i === total || Math.abs(i - current) <= 1) {
        out.push(i);
      } else if (out[out.length - 1] !== "…") {
        out.push("…");
      }
    }
    return out;
  }

  function renderPager() {
    var pages = totalPages();
    pgNow.textContent = String(state.page);
    pgCount.textContent = String(pages);
    pgTotal.textContent = String(state.total);
    while (pgNums.firstChild) pgNums.removeChild(pgNums.firstChild);
    each(pageNumbers(state.page, pages), function (num) {
      if (num === "…") {
        pgNums.appendChild(el("span", "pager-gap", "…"));
        return;
      }
      var btn = el("button", "pager-btn" + (num === state.page ? " is-on" : ""), String(num));
      btn.type = "button";
      btn.setAttribute("data-page", String(num));
      btn.setAttribute("aria-label", "第 " + num + " 页");
      if (num === state.page) btn.setAttribute("aria-current", "page");
      btn.addEventListener("click", function () {
        if (num !== state.page) loadPage(num);
      });
      pgNums.appendChild(btn);
    });
    pgPrev.disabled = state.page <= 1;
    pgNext.disabled = state.page >= pages;
  }

  function renderList() {
    var list = filteredPosts();
    renderRows(list);
    renderPager();

    if (list.length === 0) {
      if (state.total === 0) {
        setEmpty("还没有文章。点「新建文章」写下第一篇；也可以用「导入 Markdown」。", "新建文章", function () {
          openForm(null, {});
        });
      } else {
        setEmpty("当前页没有符合筛选的文章。翻页或清除筛选再看看。", "清除筛选", resetFilters);
      }
      return;
    }
    hideEmpty();
    tblWrap.hidden = false;
    pager.hidden = state.total === 0;
  }

  function renderAll() {
    renderCounts();
    renderCategoryOptions();
    renderList();
  }

  /* ---------------- 筛选 ---------------- */
  function applyStatusTab() {
    each(tabs, function (tab) {
      var on = tab.getAttribute("data-status") === state.status;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function resetFilters() {
    state.status = "all";
    state.category = "all";
    state.q = "";
    qInput.value = "";
    catSel.value = "all";
    applyStatusTab();
    renderList();
  }

  each(tabs, function (tab) {
    tab.addEventListener("click", function () {
      state.status = tab.getAttribute("data-status") || "all";
      applyStatusTab();
      renderList();
    });
  });
  qInput.addEventListener("input", function () {
    state.q = qInput.value;
    renderList();
  });
  catSel.addEventListener("change", function () {
    state.category = catSel.value;
    renderList();
  });
  sortSel.addEventListener("change", function () {
    state.sort = sortSel.value;
    renderList();
  });
  emptyBtn.addEventListener("click", function () {
    if (emptyAction) emptyAction();
  });

  /* ---------------- 行内操作 ---------------- */
  rowsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-op]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var post = null;
    each(state.posts, function (p) {
      if (p.id === id) post = p;
    });
    if (!post) return;
    var op = btn.getAttribute("data-op");
    if (op === "edit") {
      openForm(post, null);
    } else if (op === "toggle") {
      toggleStatus(post, btn);
    } else if (op === "del") {
      openDelete(post);
    }
  });

  function toggleStatus(post, btn) {
    var next = post.status === "published" ? "draft" : "published";
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    apiRequest("/" + encodeURIComponent(post.id), { method: "PATCH", body: { status: next } })
      .then(function (result) {
        if (result.res.ok && result.data && result.data.item) {
          replacePost(result.data.item);
          renderAll();
          toast(next === "published" ? "已发布 · 前台将同步《" + post.title + "》" : "已转为草稿《" + post.title + "》");
          return;
        }
        if (result.res.status === 401) {
          showBanner(
            "error",
            "切换失败 · 管理令牌无效（401）",
            "去「设置 / 管理令牌」更新令牌后再试；本地令牌通常是 dev-admin-token。"
          );
          bannerLink("去设置令牌 →", "/admin/settings");
          toast("切换失败 · 令牌无效");
          return;
        }
        if (result.res.status === 404) {
          toast("文章已不存在 · 正在刷新列表");
          loadPage(state.page);
          return;
        }
        toast("切换失败 · HTTP " + result.res.status);
      })
      .catch(function () {
        toast("切换失败 · 请检查网络或服务");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
  }

  function replacePost(item) {
    if (!item || !item.id) return;
    for (var i = 0; i < state.posts.length; i++) {
      if (state.posts[i].id === item.id) {
        state.posts[i] = item;
        return;
      }
    }
  }

  /* ---------------- 新建 / 编辑表单 ---------------- */
  function setFormBusy(on) {
    formSave.disabled = on;
    formCancel.disabled = on;
    if (on) {
      formSave.textContent = state.editing ? "保存中…" : "创建中…";
    } else {
      formSave.textContent = state.editing ? "保存修改" : "创建文章";
    }
  }

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
    each(document.querySelectorAll(".post-fields .pf.is-invalid"), function (pf) {
      pf.classList.remove("is-invalid");
    });
  }

  function markFields(paths) {
    clearFieldMarks();
    each(paths || [], function (path) {
      var id = FIELD_IDS[path];
      if (!id) return;
      var field = $(id);
      var pf = field && field.closest(".pf");
      if (pf) pf.classList.add("is-invalid");
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
    fTitle.focus();
  }

  function updateBodyHint() {
    var chars = charCount(fBody.value);
    bodyHint.textContent = fmtNumber(chars) + " 字 · 约 " + Math.max(1, Math.ceil(chars / 400)) + " 分钟";
  }

  function openForm(post, prefill) {
    state.editing = post || null;
    hideFormBanner();
    clearFieldMarks();
    postForm.reset();

    if (post) {
      fTitle.value = post.title || "";
      fSlug.value = post.slug || "";
      fCategory.value = post.category || "随笔";
      fStatus.value = post.status || "draft";
      fExcerpt.value = post.excerpt || "";
      fBody.value = post.bodyMd || "";
      postDlgNo.textContent = "EDIT";
      postDlgTitle.textContent = "编辑文章";
      postDlgState.textContent = "更新于 " + fmtUpdated(post.updatedAt || post.createdAt);
      postMeta.textContent = "文章 ID · " + post.id;
    } else {
      var data = prefill || {};
      fTitle.value = data.title || "";
      fSlug.value = data.slug || "";
      fCategory.value = data.category || "随笔";
      fStatus.value = data.status || "draft";
      fExcerpt.value = data.excerpt || "";
      fBody.value = data.bodyMd || "";
      postDlgNo.textContent = "NEW";
      postDlgTitle.textContent = "新建文章";
      postDlgState.textContent = "未保存";
      postMeta.textContent = "新增的文章默认存为草稿 · 发布后前台可见";
    }
    setFormBusy(false);
    updateBodyHint();
    if (typeof postDlg.showModal === "function") postDlg.showModal();
    fTitle.focus();
  }

  function closeForm() {
    if (state.saving) return;
    if (typeof postDlg.close === "function") postDlg.close();
    state.editing = null;
  }

  function collectForm() {
    return {
      title: fTitle.value.trim(),
      slug: fSlug.value.trim(),
      category: fCategory.value.trim(),
      status: fStatus.value,
      excerpt: fExcerpt.value.trim(),
      bodyMd: fBody.value
    };
  }

  function validateForm(data) {
    var issues = [];
    if (!data.title) issues.push({ path: "title", message: "标题不能为空" });
    else if (data.title.length > 200) issues.push({ path: "title", message: "标题最多 200 个字符" });
    if (!data.slug) issues.push({ path: "slug", message: "slug 不能为空" });
    else if (!/^[a-z0-9-]+$/.test(data.slug)) issues.push({ path: "slug", message: "只能是小写字母、数字和连字符" });
    else if (data.slug.length > 120) issues.push({ path: "slug", message: "slug 最多 120 个字符" });
    if (!data.category) issues.push({ path: "category", message: "分类不能为空" });
    else if (data.category.length > 40) issues.push({ path: "category", message: "分类最多 40 个字符" });
    if (data.excerpt.length > 400) issues.push({ path: "excerpt", message: "摘要最多 400 个字符" });
    if (data.bodyMd.length > 200000) issues.push({ path: "bodyMd", message: "正文最多 200000 个字符" });
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
      markFields(issues.map(function (issue) { return issue.path; }));
      focusFirstIssue(issues);
      return;
    }

    var editing = state.editing;
    var path = editing ? "/" + encodeURIComponent(editing.id) : "";
    state.saving = true;
    setFormBusy(true);
    hideFormBanner();

    apiRequest(path, { method: editing ? "PATCH" : "POST", body: data })
      .then(function (result) {
        if (result.res.ok && result.data && result.data.item) {
          var item = result.data.item;
          state.saving = false;
          setFormBusy(false);
          if (typeof postDlg.close === "function") postDlg.close();
          state.editing = null;
          toast((editing ? "已保存《" : "已创建《") + item.title + "》");
          loadPage(1);
          return;
        }
        if (result.res.status === 409) {
          showFormBanner(
            "error",
            "slug 已被占用",
            "换一个 slug 再保存：「" + data.slug + "」已经有文章在用。",
            [{ path: "slug", message: "slug_taken" }]
          );
          markFields(["slug"]);
          fSlug.focus();
          return;
        }
        if (result.res.status === 400) {
          var serverIssues = (result.data && result.data.issues) || [];
          showFormBanner("error", "保存失败 · 字段校验未通过", "修正下列字段后重新保存：", serverIssues);
          markFields(serverIssues.map(function (issue) { return issue.path; }));
          focusFirstIssue(serverIssues);
          return;
        }
        if (result.res.status === 401) {
          showFormBanner("error", "保存失败 · 管理令牌无效（401）", "去「设置 / 管理令牌」更新令牌后重试；本地令牌通常是 dev-admin-token。");
          return;
        }
        if (result.res.status === 503) {
          showFormBanner("warn", "保存失败 · 服务端未配置 ADMIN_TOKEN", "本地请在 apps/web/.dev.vars 里配置 ADMIN_TOKEN 后重启开发服务器。");
          return;
        }
        showFormBanner("error", "保存失败（HTTP " + result.res.status + "）", "服务端返回异常，稍后重试；问题持续时查看 Worker 日志。");
      })
      .catch(function () {
        showFormBanner("error", "保存失败 · 网络异常", "检查开发服务器是否在运行，或稍后重试。");
      })
      .then(function () {
        state.saving = false;
        setFormBusy(false);
      });
  }

  /* ---------------- 删除 ---------------- */
  function openDelete(post) {
    state.deleting = post;
    delTarget.textContent = "《" + (post.title || "无标题") + "》 · slug: " + (post.slug || "—") + " · " + statusLabel(post.status);
    delOk.disabled = false;
    delOk.textContent = "删除";
    if (typeof delDlg.showModal === "function") delDlg.showModal();
  }

  function closeDelete() {
    if (typeof delDlg.close === "function") delDlg.close();
    state.deleting = null;
  }

  function confirmDelete() {
    var post = state.deleting;
    if (!post) return;
    delOk.disabled = true;
    delOk.textContent = "删除中…";
    apiRequest("/" + encodeURIComponent(post.id), { method: "DELETE" })
      .then(function (result) {
        if (result.res.ok) {
          closeDelete();
          toast("已删除《" + post.title + "》");
          loadPage(state.page);
          return;
        }
        if (result.res.status === 404) {
          closeDelete();
          toast("文章已不存在 · 正在刷新列表");
          loadPage(state.page);
          return;
        }
        if (result.res.status === 401) {
          closeDelete();
          showBanner(
            "error",
            "删除失败 · 管理令牌无效（401）",
            "去「设置 / 管理令牌」更新令牌后再试；本地令牌通常是 dev-admin-token。"
          );
          bannerLink("去设置令牌 →", "/admin/settings");
          toast("删除失败 · 令牌无效");
          return;
        }
        delOk.disabled = false;
        delOk.textContent = "删除";
        toast("删除失败 · HTTP " + result.res.status);
      })
      .catch(function () {
        delOk.disabled = false;
        delOk.textContent = "删除";
        toast("删除失败 · 请检查网络或服务");
      });
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function stripMarkdown(markdown) {
    return String(markdown || "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`>[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function handleImportFiles(files) {
    if (!files || !files.length) return;
    var file = files[0];
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      var name = file.name.replace(/\.(md|markdown)$/i, "");
      var title = name.replace(/[-_]+/g, " ").trim() || "导入的文章";
      openForm(null, {
        title: title,
        slug: slugify(name) || "imported-post",
        category: "随笔",
        status: "draft",
        excerpt: stripMarkdown(text).slice(0, 120),
        bodyMd: text
      });
      toast("已读取 " + file.name + " · 确认字段后保存");
    };
    reader.onerror = function () {
      toast("读取文件失败 · 换一个 Markdown 试试");
    };
    reader.readAsText(file);
    mdInput.value = "";
  }

  function exportPosts() {
    if (!state.posts.length) {
      toast("当前页没有可导出的文章");
      return;
    }
    var data = state.posts.map(function (post) {
      return {
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        status: post.status,
        category: post.category,
        readingMinutes: post.readingMinutes,
        updatedAt: post.updatedAt,
        publishedAt: post.publishedAt
      };
    });
    var blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), page: state.page, total: state.total, items: data }, null, 2)],
      { type: "application/json" }
    );
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "myon-articles.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1200);
    toast("已导出当前页 " + data.length + " 篇文章 · myon-articles.json");
  }

  /* ---------------- 事件绑定 ---------------- */
  btnNew.addEventListener("click", function () {
    openForm(null, {});
  });
  btnImport.addEventListener("click", function () {
    mdInput.click();
  });
  mdInput.addEventListener("change", function () {
    handleImportFiles(mdInput.files);
  });
  btnExport.addEventListener("click", exportPosts);

  postForm.addEventListener("submit", submitForm);
  formCancel.addEventListener("click", closeForm);
  postDlg.addEventListener("click", function (e) {
    if (e.target === postDlg) closeForm();
  });
  postDlg.addEventListener("close", function () {
    if (!state.saving) state.editing = null;
  });
  fBody.addEventListener("input", updateBodyHint);

  delCancel.addEventListener("click", closeDelete);
  delOk.addEventListener("click", confirmDelete);
  delDlg.addEventListener("click", function (e) {
    if (e.target === delDlg) closeDelete();
  });

  pgPrev.addEventListener("click", function () {
    if (state.page > 1) loadPage(state.page - 1);
  });
  pgNext.addEventListener("click", function () {
    if (state.page < totalPages()) loadPage(state.page + 1);
  });

  /* ---------------- 初始化 ---------------- */
  resetCounts();
  applyStatusTab();
  loadPage(readPageParam());
})();
