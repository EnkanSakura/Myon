(function () {
  "use strict";

  /* ==========================================================================
     后台追番：只读列表。条目由 Bangumi 同步维护，页面不提供任何编辑操作。
     数据走公开 GET /api/v1/bangumi；手动同步仍需要管理令牌。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var STATUS = {
    watching: "进行中",
    watched: "已完成",
    wish: "想看",
    paused: "暂缓"
  };
  var SUBJECT_TYPE = {
    anime: "动画",
    book: "书籍",
    music: "音乐",
    game: "游戏",
    real: "三次元"
  };

  var page = document.querySelector(".page[data-api]");
  if (!page) return;
  var apiBase = page.getAttribute("data-api") || "";
  var coverBase = apiBase.replace(/\/bangumi$/, "/bangumi/cover");
  var syncApi = page.getAttribute("data-sync-api") || "";
  var listEl = document.getElementById("watchList");
  var syncBtn = document.getElementById("syncMain");
  var syncLabel = document.getElementById("syncMainLabel");
  var exportBtn = document.getElementById("exportBtn");
  var banner = document.getElementById("tbanner");
  var bannerK = document.getElementById("tbannerK");
  var bannerTitle = document.getElementById("tbannerTitle");
  var bannerText = document.getElementById("tbannerText");
  var bannerToken = document.getElementById("tbannerLink");
  var toastEl = document.getElementById("toast");
  var typeChips = document.querySelectorAll(".filterbar .chip[data-type]");
  var clearBtn = document.getElementById("clearFilters");

  var state = {
    items: [],
    typeFilter: "all",
    loading: false,
    syncing: false
  };
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setText(id, text) {
    var node = $(id);
    if (node) node.textContent = text;
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function readToken() {
    try { return (localStorage.getItem(TOKEN_KEY) || "").trim(); } catch (e) { return ""; }
  }

  function formatDate(value) {
    if (!value) return "—";
    return String(value).slice(0, 10).replace(/-/g, ".");
  }
  function formatDateTime(value) {
    if (!value) return "—";
    var date = formatDate(value);
    var time = String(value).slice(11, 16);
    return time ? date + " " + time : date;
  }
  function scoreText(score) {
    return typeof score === "number" && isFinite(score)
      ? "我的评分 " + Number(score).toFixed(0)
      : "未评分";
  }

  var AIR_FORMAT = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  function nextAirText(value) {
    if (!value) return "待定";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "待定";
    var parts = {};
    Array.prototype.forEach.call(AIR_FORMAT.formatToParts(date), function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return (parts.month || "--") + "." + (parts.day || "--") + " " +
      (parts.weekday || "") + " " + (parts.hour || "--") + ":" + (parts.minute || "--");
  }

  /** mediaKey → /media/<key>；外链与站内绝对路径原样返回。 */
  function mediaUrl(key) {
    if (!key) return "";
    if (/^(https?:)?\/\//.test(key) || key.charAt(0) === "/") return key;
    return "/media/" + key.replace(/^\/+/, "");
  }

  /** 封面优先走站内代理 + 边缘缓存；没有源图时退回已有 R2/手填封面。 */
  function coverUrl(item) {
    var source = String(item.coverSource || "").trim();
    if (source) {
      return coverBase + "?src=" + encodeURIComponent(source);
    }
    return mediaUrl(item.coverKey);
  }

  /** 各类型进度单位不同；书籍按卷、音乐按曲、游戏按百分比。 */
  function progressOf(item) {
    var total = Math.max(0, item.totalEps || 0);
    var watchedRaw = Math.max(0, item.watchedEps || 0);
    var watched = total > 0 ? Math.min(watchedRaw, total) : watchedRaw;
    var pct = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0;
    var text = "";
    if (item.subjectType === "book") {
      text = total > 0 ? "第 " + watched + " 卷 / 共 " + total + " 卷" : "已读 " + watched + " 卷";
    } else if (item.subjectType === "music") {
      text = total > 0 ? "第 " + watched + " 曲 / 共 " + total + " 曲" : "已听 " + watched + " 曲";
    } else if (item.subjectType === "game") {
      text = total > 0 ? "进度 " + pct + "%" : "进度待定";
    } else {
      text = total > 0 ? "EP." + pad2(watched) + " / " + total : "已看 " + watched + " 集";
    }
    return { pct: pct, text: text };
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function showBanner(tone, title, text, withToken) {
    if (!banner) return;
    banner.hidden = false;
    banner.className = "notice notice--" + tone;
    if (bannerK) bannerK.textContent = tone === "error" ? "ERROR" : tone === "warn" ? "WARN" : "INFO";
    if (bannerTitle) bannerTitle.textContent = title;
    if (bannerText) bannerText.textContent = text;
    if (bannerToken) bannerToken.hidden = !withToken;
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-on");
    }, 2600);
  }

  function readJson(response) {
    return response.json().catch(function () { return {}; });
  }

  function loadItems() {
    if (state.loading) return;
    state.loading = true;
    if (listEl) listEl.setAttribute("aria-busy", "true");
    setText("pageState", "正在读取…");

    var all = [];
    function next(offset) {
      return fetch(apiBase + "?limit=100&offset=" + offset, {
        headers: { accept: "application/json" },
        cache: "no-store"
      }).then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok) throw new Error("读取失败");
          var items = Array.isArray(body.items) ? body.items : [];
          all = all.concat(items);
          var total = Number(body.total) || all.length;
          if (items.length > 0 && all.length < total && all.length < 1000) {
            return next(all.length);
          }
          return all;
        });
      });
    }

    next(0)
      .then(function (items) {
        state.items = items.sort(function (a, b) {
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        });
        renderAll();
        showBanner("info", "只读列表", "条目由 Bangumi 同步维护；修改评分、评论或进度请到 Bangumi，之后点「同步 Bangumi」。", false);
        setText("pageState", "已加载 · " + new Date().toTimeString().slice(0, 5));
      })
      .catch(function (error) {
        console.error("[admin-bangumi] 读取失败", error);
        if (listEl) {
          listEl.innerHTML = "";
          var empty = el("div", "empty");
          var content = el("div", "empty-c");
          content.appendChild(el("p", "empty-t", "追番记录读取失败"));
          content.appendChild(el("p", "empty-d", "检查网络后刷新页面重试。"));
          empty.appendChild(content);
          listEl.appendChild(empty);
        }
        showBanner("error", "读取失败", "公开追番接口没有返回数据，请刷新页面重试。", false);
        setText("pageState", "读取失败");
      })
      .finally(function () {
        state.loading = false;
        if (listEl) listEl.setAttribute("aria-busy", "false");
      });
  }

  function typeLabel(type) { return SUBJECT_TYPE[type] || type; }
  function statusLabel(status) { return STATUS[status] || status; }

  function renderRow(item) {
    var progress = progressOf(item);
    var row = el("article", "wrow");
    row.setAttribute("data-id", item.id);
    row.setAttribute("data-status", item.status);
    row.setAttribute("data-type", typeLabel(item.subjectType));

    var frame = el("span", "mini-frame");
    var cover = coverUrl(item);
    if (cover) {
      var img = document.createElement("img");
      img.src = cover;
      img.alt = "《" + item.title + "》封面";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", function () {
        img.remove();
        frame.classList.add("is-missing");
      }, { once: true });
      frame.appendChild(img);
    } else {
      frame.appendChild(el("span", "mini-empty", "NO COVER"));
    }
    row.appendChild(frame);

    var main = el("div", "w-main");
    var top = el("div", "w-top");
    top.appendChild(el("span", "w-title", item.title));
    var chip = el("span", "w-state");
    chip.appendChild(el("i", "sq"));
    chip.appendChild(el("span", "w-st", statusLabel(item.status)));
    top.appendChild(chip);
    if (item.bangumiId) top.appendChild(el("span", "w-bgm", "BGM #" + item.bangumiId));
    main.appendChild(top);

    var meta = el("div", "w-meta");
    meta.appendChild(el("span", "w-meta-k", "类型"));
    meta.appendChild(el("span", "w-meta-v", typeLabel(item.subjectType)));
    meta.appendChild(el("span", "msep", "·"));
    meta.appendChild(el("span", "w-meta-v", scoreText(item.score)));
    meta.appendChild(el("span", "msep", "·"));
    meta.appendChild(el("span", "w-meta-k", "下次放送"));
    meta.appendChild(el("span", "w-meta-v", nextAirText(item.nextAirAt)));
    meta.appendChild(el("span", "msep", "·"));
    meta.appendChild(el("span", "w-meta-k", "更新"));
    meta.appendChild(el("span", "w-meta-v", formatDateTime(item.updatedAt)));
    main.appendChild(meta);

    if (item.comment) {
      main.appendChild(el("p", "w-comment-read", item.comment));
    }

    var prog = el("div", "w-prog");
    var bar = el("span", "w-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", progress.text);
    var fill = el("i");
    fill.style.width = progress.pct + "%";
    bar.appendChild(fill);
    prog.appendChild(bar);
    prog.appendChild(el("span", "w-ep", progress.text));
    main.appendChild(prog);
    row.appendChild(main);
    return row;
  }

  function renderList() {
    if (!listEl) return;
    var filtered = state.items.filter(function (item) {
      return state.typeFilter === "all" || (item.subjectType || "anime") === state.typeFilter;
    });
    listEl.innerHTML = "";
    if (filtered.length === 0) {
      var empty = el("div", "empty");
      var content = el("div", "empty-c");
      content.appendChild(el("p", "empty-t", "这一栏还没有记录"));
      content.appendChild(el("p", "empty-d", "等 Bangumi 同步完成，或点「清除」看全部记录。"));
      empty.appendChild(content);
      listEl.appendChild(empty);
    } else {
      filtered.forEach(function (item) { listEl.appendChild(renderRow(item)); });
    }
    setText("secEn", (state.typeFilter === "all" ? "ALL" : state.typeFilter.toUpperCase()) + " / " + filtered.length);
    setText("fbCount", "显示 " + filtered.length + " 条 · 只读列表");
  }

  function renderMetrics() {
    var counts = { watched: 0, watching: 0, wish: 0, paused: 0 };
    state.items.forEach(function (item) {
      if (counts[item.status] === undefined) counts[item.status] = 0;
      counts[item.status] += 1;
    });
    setText("mWatched", String(counts.watched));
    setText("mWatching", String(counts.watching));
    setText("mWish", String(counts.wish));
    setText("mWatchedNote", counts.watched > 0 ? "条 · 已看完" : "暂无");
    setText("mWatchingNote", counts.watching > 0 ? "条 · 正在追" : "暂无");
    setText("mWishNote", counts.wish > 0 ? "条 · 待补" : "暂无");
    setText("pTotal", String(state.items.length));
    setText("fbCount", "显示 " + state.items.length + " 条 · 只读列表");
    var latest = state.items.reduce(function (result, item) {
      if (!item.updatedAt) return result;
      if (!result || item.updatedAt > result) return item.updatedAt;
      return result;
    }, "");
    setText("latestUpdated", latest ? formatDateTime(latest) : "—");
  }

  function renderAll() {
    renderMetrics();
    renderList();
  }

  function paintTypeChips() {
    Array.prototype.forEach.call(typeChips, function (chip) {
      var on = (chip.getAttribute("data-type") || "all") === state.typeFilter;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncBangumi() {
    if (state.syncing) return;
    var token = readToken();
    if (!token) {
      showBanner("warn", "需要管理令牌", "同步会请求 Bangumi 并写入 D1，请先在右上角填写管理令牌。", true);
      return;
    }
    state.syncing = true;
    if (syncBtn) syncBtn.disabled = true;
    if (syncLabel) syncLabel.textContent = "同步中…";

    fetch(syncApi, {
      method: "POST",
      headers: { accept: "application/json", "x-admin-token": token }
    })
      .then(function (response) {
        return readJson(response).then(function (body) { return { response: response, body: body }; });
      })
      .then(function (result) {
        if (result.response.status === 401) {
          showBanner("warn", "令牌无效", "右上角的管理令牌未通过校验，请重新填写。", true);
          return;
        }
        if (result.response.status === 503) {
          showBanner("warn", "服务端只读", "服务端没有配置管理令牌，暂时不能同步。", false);
          return;
        }
        if (!result.response.ok || !result.body.ok) {
          showBanner("error", "同步失败", result.body.reason ? "Bangumi 返回：" + result.body.reason : "同步没有完成，请稍后重试。", false);
          return;
        }
        toast("同步 " + (result.body.synced || 0) + " 条记录");
        return loadItems();
      })
      .catch(function (error) {
        console.error("[admin-bangumi] 同步失败", error);
        showBanner("error", "同步失败", "网络请求没有完成，请稍后重试。", false);
      })
      .finally(function () {
        state.syncing = false;
        if (syncBtn) syncBtn.disabled = false;
        if (syncLabel) syncLabel.textContent = "同步 Bangumi";
      });
  }

  function exportRecords() {
    var payload = JSON.stringify(state.items, null, 2);
    var blob = new Blob([payload], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "myon-bangumi.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出 · myon-bangumi.json");
  }

  Array.prototype.forEach.call(typeChips, function (chip) {
    chip.addEventListener("click", function () {
      state.typeFilter = chip.getAttribute("data-type") || "all";
      paintTypeChips();
      renderList();
    });
  });
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      state.typeFilter = "all";
      paintTypeChips();
      renderList();
    });
  }
  if (syncBtn) syncBtn.addEventListener("click", syncBangumi);
  if (exportBtn) exportBtn.addEventListener("click", exportRecords);

  paintTypeChips();
  loadItems();
})();
