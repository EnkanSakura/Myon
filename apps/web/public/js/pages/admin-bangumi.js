(function () {
  "use strict";

  /* ---------------- 常量 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var MAX_EPS = 9999;
  var STATUS_ORDER = ["watching", "watched", "wish", "paused"];
  var STATUS = {
    watching: { label: "在追" },
    watched: { label: "看过" },
    wish: { label: "想看" },
    paused: { label: "暂缓" }
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function clockNow() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setText(node, text) { if (node) node.textContent = text; }

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
    return typeof score === "number" && isFinite(score) ? Number(score).toFixed(1) : "—";
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
  /** 下次放送按 UTC+8 展示；解析失败或为空都返回“待定”。 */
  function nextAirText(value) {
    if (!value) return "待定";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "待定";
    var parts = {};
    each(AIR_FORMAT.formatToParts(date), function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return (parts.month || "--") + "." + (parts.day || "--") + " " +
      (parts.weekday || "") + " " + (parts.hour || "--") + ":" + (parts.minute || "--");
  }

  /** mediaKey → /media/<key>；外链与站内绝对路径原样返回。 */
  function mediaUrl(key) {
    if (!key) return "";
    var value = String(key);
    if (/^(https?:)?\/\//.test(value) || value.charAt(0) === "/") return value;
    return "/media/" + value.replace(/^\/+/, "");
  }

  /** 进度口径：总集数未知时不计算百分比，已看不截断显示但进度条按总数封顶。 */
  function progressOf(item) {
    var total = Math.max(0, Number(item.totalEps) || 0);
    var watched = Math.max(0, Number(item.watchedEps) || 0);
    var shown = total > 0 ? Math.min(watched, total) : watched;
    var pct = total > 0 ? Math.min(100, Math.round((shown / total) * 100)) : 0;
    return {
      total: total,
      watched: watched,
      shown: shown,
      pct: pct,
      epText: total > 0 ? "EP." + pad2(shown) + " / " + total : "EP." + pad2(shown),
      label: total > 0 ? "已看 " + shown + " 话，共 " + total + " 话" : "已看 " + shown + " 话，总集数未定"
    };
  }

  /* ---------------- 元素与状态 ---------------- */
  var pageEl = document.querySelector(".page[data-api]");
  var API_URL = pageEl ? pageEl.getAttribute("data-api") : "";

  var listEl = $("watchList");
  var pageState = $("pageState");
  var banner = $("tbanner");
  var tbannerK = $("tbannerK");
  var tbannerTitle = $("tbannerTitle");
  var tbannerText = $("tbannerText");
  var tbannerLink = $("tbannerLink");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  var syncbar = $("syncbar");
  var syncMeta = $("syncMeta");
  var syncState = $("syncState");
  var syncResult = $("syncResult");
  var syncBtn = $("syncBtn");
  var syncBtnLabel = $("syncBtnLabel");
  var syncMain = $("syncMain");
  var syncMainLabel = $("syncMainLabel");

  var exportBtn = $("exportBtn");
  var latestUpdated = $("latestUpdated");
  var footUpdated = $("footUpdated");
  var secEn = $("secEn");
  var railBangumi = $("railBangumi");

  var toastEl = $("toast");
  var toastTimer = null;

  var cfmDlg = $("cfmDlg");
  var cfmText = $("cfmText");
  var cfmCancel = $("cfmCancel");
  var cfmOk = $("cfmOk");
  var pendingDeleteId = null;

  var state = {
    token: (readStore(TOKEN_KEY) || "").trim(),
    items: [],
    loading: true,
    authorized: false,
    syncing: false,
    busy: {}
  };

  /* ---------------- 提示 ---------------- */
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }

  function setNoticeTone(tone) {
    each(NOTICE_TONES, function (name) { banner.classList.remove(name); });
    banner.classList.add("notice--" + tone);
  }

  function showBanner(tone, title, text, showLink) {
    if (!banner) return;
    banner.hidden = false;
    setNoticeTone(tone);
    setText(tbannerK, tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO");
    setText(tbannerTitle, title);
    setText(tbannerText, text || "");
    if (tbannerText) tbannerText.hidden = !text;
    if (tbannerLink) tbannerLink.hidden = !showLink;
  }
  function hideBanner() {
    if (banner) banner.hidden = true;
  }
  function setPageState(text) {
    setText(pageState, text);
  }

  /* ---------------- 接口请求 ---------------- */
  function api(method, path, body) {
    var headers = { accept: "application/json", "x-admin-token": state.token };
    var init = { method: method, headers: headers, cache: "no-store" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(API_URL + path, init);
  }
  function readJson(res) {
    return res.json().catch(function () { return {}; });
  }

  /** 401 / 503 的处理；返回 true 表示已经被拦下。 */
  function authFailure(status) {
    if (status === 401) {
      state.authorized = false;
      showBanner("error", "管理令牌无效（401）", "令牌与 ADMIN_TOKEN 不一致。到「设置」页更新令牌后刷新本页。", true);
      setPageState("未授权 · 令牌无效");
      return true;
    }
    if (status === 503) {
      state.authorized = false;
      showBanner("warn", "服务端未配置 ADMIN_TOKEN，当前只读", "接口返回 503：在 Workers 变量或本地 .dev.vars 配置 ADMIN_TOKEN 后重新加载页面。", false);
      setPageState("只读 · 服务端未配置 ADMIN_TOKEN");
      return true;
    }
    return false;
  }

  function canWrite() {
    if (!state.token) {
      showBanner("info", "尚未填写管理令牌", "后台接口需要 x-admin-token。令牌只存在本机 localStorage：到「设置」页填入 ADMIN_TOKEN（本地开发是 dev-admin-token）后刷新本页。", true);
      toast("未填写管理令牌 · 无法写入");
      return false;
    }
    if (!state.authorized) {
      showBanner("error", "尚未连接后台接口", "请先在「设置」页校验管理令牌，再回到本页操作。", true);
      toast("尚未连接后台接口");
      return false;
    }
    return true;
  }

  /* ---------------- 查找与局部更新 ---------------- */
  function findItem(id) {
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }
  function findRow(id) {
    if (!listEl) return null;
    var rows = listEl.querySelectorAll(".wrow");
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].getAttribute("data-id") === id) return rows[i];
    }
    return null;
  }
  function lockRow(id) {
    var row = findRow(id);
    if (!row) return;
    row.classList.add("is-busy");
    row.setAttribute("aria-busy", "true");
    each(row.querySelectorAll("button, input, select"), function (control) {
      control.disabled = true;
    });
  }
  function updateItem(item) {
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].id === item.id) {
        state.items[i] = item;
        return;
      }
    }
  }

  /* ---------------- 渲染：统计 / 列表 ---------------- */
  function countByStatus(status) {
    var count = 0;
    each(state.items, function (item) {
      if (item.status === status) count += 1;
    });
    return count;
  }
  function averageScore() {
    var sum = 0;
    var count = 0;
    each(state.items, function (item) {
      if (typeof item.score === "number" && isFinite(item.score)) {
        sum += item.score;
        count += 1;
      }
    });
    return count > 0 ? { value: sum / count, count: count } : { value: null, count: 0 };
  }
  function latestUpdatedAt() {
    var latest = "";
    each(state.items, function (item) {
      if (item.updatedAt && String(item.updatedAt) > latest) latest = String(item.updatedAt);
    });
    return latest;
  }

  function renderStats() {
    var watched = countByStatus("watched");
    var watching = countByStatus("watching");
    var wish = countByStatus("wish");
    var avg = averageScore();
    var latest = latestUpdatedAt();

    setText($("pTotal"), state.authorized ? String(state.items.length) : "—");
    setText($("pWatching"), state.authorized ? String(watching) : "—");
    setText($("pAvg"), avg.value === null ? "—" : avg.value.toFixed(1));
    setText($("mWatched"), state.authorized ? String(watched) : "—");
    setText($("mWatching"), state.authorized ? String(watching) : "—");
    setText($("mWish"), state.authorized ? String(wish) : "—");
    setText($("mAvg"), avg.value === null ? "—" : avg.value.toFixed(1));
    setText($("mWatchedNote"), "部 · " + (state.authorized ? "来自 D1" : "未连接"));
    setText($("mWatchingNote"), "部 · " + (state.authorized ? "前台同源" : "未连接"));
    setText($("mWishNote"), "部 · 待补清单");
    setText($("mAvgNote"), avg.count > 0 ? "分 · " + avg.count + " 部有评分" : "分 · 暂无评分");
    setText(latestUpdated, latest ? formatDateTime(latest) : "—");
    setText(footUpdated, latest ? formatDateTime(latest) : "—");
    setText(secEn, "ALL / " + (state.authorized ? pad2(state.items.length) : "—"));
    setText(railBangumi, state.authorized ? String(state.items.length) : "—");
  }

  function listStateNode(title, text) {
    var node = el("div", "empty");
    var copy = el("div", "empty-c");
    copy.appendChild(el("b", "empty-t", title));
    if (text) copy.appendChild(el("p", "empty-d", text));
    node.appendChild(copy);
    return node;
  }

  function wBtn(action, label) {
    var button = el("button", "w-btn", label);
    button.type = "button";
    button.setAttribute("data-act", action);
    return button;
  }

  function renderRow(item) {
    var progress = progressOf(item);
    var busy = !!state.busy[item.id];
    var row = el("article", "wrow");
    row.setAttribute("data-id", item.id);
    row.setAttribute("data-status", item.status);
    if (busy) {
      row.classList.add("is-busy");
      row.setAttribute("aria-busy", "true");
    }

    /* 封面 */
    var frame = el("span", "mini-frame");
    var cover = mediaUrl(item.coverKey);
    if (cover) {
      var img = document.createElement("img");
      img.src = cover;
      img.alt = "《" + item.title + "》封面";
      img.loading = "lazy";
      img.decoding = "async";
      frame.appendChild(img);
    } else {
      frame.appendChild(el("span", "mini-empty", "NO COVER"));
    }
    row.appendChild(frame);

    /* 标题 / 状态 */
    var main = el("div", "w-main");
    var top = el("div", "w-top");
    top.appendChild(el("span", "w-title", item.title));
    var chip = el("span", "w-state");
    chip.appendChild(el("i", "sq"));
    chip.appendChild(el("span", "w-st", STATUS[item.status] ? STATUS[item.status].label : item.status));
    top.appendChild(chip);
    if (item.bangumiId) top.appendChild(el("span", "w-bgm", "BGM #" + item.bangumiId));
    main.appendChild(top);

    /* 评分（可编辑）/ 下次放送 / 更新时间 */
    var meta = el("div", "w-meta");
    meta.appendChild(el("span", "w-meta-k", "评分"));
    var scoreInput = document.createElement("input");
    scoreInput.className = "w-score";
    scoreInput.type = "number";
    scoreInput.min = "0";
    scoreInput.max = "10";
    scoreInput.step = "1";
    scoreInput.value = typeof item.score === "number" ? String(item.score) : "";
    scoreInput.placeholder = "—";
    scoreInput.setAttribute("aria-label", "《" + item.title + "》评分");
    meta.appendChild(scoreInput);
    meta.appendChild(el("span", "msep", "·"));
    meta.appendChild(el("span", "w-meta-k", "下次放送"));
    meta.appendChild(el("span", "w-meta-v", nextAirText(item.nextAirAt)));
    meta.appendChild(el("span", "msep", "·"));
    meta.appendChild(el("span", "w-meta-k", "更新"));
    meta.appendChild(el("span", "w-meta-v", formatDateTime(item.updatedAt)));
    main.appendChild(meta);

    /* 进度条 + 集数输入 */
    var prog = el("div", "w-prog");
    var bar = el("span", "w-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", progress.label);
    var fill = el("i");
    fill.style.width = progress.pct + "%";
    bar.appendChild(fill);
    prog.appendChild(bar);
    prog.appendChild(el("span", "w-ep", progress.epText));
    var inputLabel = el("label", "w-eps");
    inputLabel.appendChild(el("span", "sr-only", "已看集数"));
    var epsInput = document.createElement("input");
    epsInput.className = "w-input";
    epsInput.type = "number";
    epsInput.min = "0";
    epsInput.step = "1";
    if (progress.total > 0) epsInput.max = String(progress.total);
    epsInput.value = String(progress.shown);
    epsInput.setAttribute("aria-label", "《" + item.title + "》已看集数");
    inputLabel.appendChild(epsInput);
    if (progress.total > 0) inputLabel.appendChild(el("span", "w-eps-total", "/ " + progress.total));
    prog.appendChild(inputLabel);
    prog.appendChild(el("span", "w-pct", progress.pct + "%"));
    main.appendChild(prog);
    row.appendChild(main);

    /* 操作：±1 / 状态 / 删除 */
    var acts = el("div", "w-acts");
    acts.appendChild(wBtn("minus", "−1 话"));
    acts.appendChild(wBtn("plus", "+1 话"));
    var select = document.createElement("select");
    select.className = "w-select";
    select.setAttribute("aria-label", "《" + item.title + "》状态");
    each(STATUS_ORDER, function (status) {
      var option = document.createElement("option");
      option.value = status;
      option.textContent = STATUS[status].label;
      if (status === item.status) option.selected = true;
      select.appendChild(option);
    });
    acts.appendChild(select);
    var del = wBtn("delete", "删除");
    del.classList.add("w-btn--danger");
    acts.appendChild(del);
    row.appendChild(acts);

    if (busy) {
      each(row.querySelectorAll("button, input, select"), function (control) {
        control.disabled = true;
      });
    }
    return row;
  }

  function renderList() {
    if (!listEl) return;
    listEl.textContent = "";
    listEl.setAttribute("aria-busy", state.loading ? "true" : "false");

    if (state.loading) {
      listEl.appendChild(listStateNode("正在读取 D1 …", "列表来自 GET /api/v1/admin/bangumi。"));
      return;
    }
    if (!state.token) {
      listEl.appendChild(listStateNode("未连接：尚未填写管理令牌。", "到「设置」页填入 ADMIN_TOKEN（本地开发是 dev-admin-token）后刷新本页。"));
      return;
    }
    if (!state.authorized) {
      listEl.appendChild(listStateNode("未连接：令牌无效或服务端未配置 ADMIN_TOKEN。", "按上方提示修正后刷新本页。"));
      return;
    }
    if (state.items.length === 0) {
      listEl.appendChild(listStateNode("还没有追番记录。", "同步 Bangumi 或用 POST /api/v1/admin/bangumi 手动新增后，这里会显示记录。"));
      return;
    }

    var fragment = document.createDocumentFragment();
    each(state.items, function (item) {
      fragment.appendChild(renderRow(item));
    });
    listEl.appendChild(fragment);
  }

  function renderAll() {
    renderStats();
    renderList();
  }

  /* ---------------- 写入：进度 / 状态 / 评分 ---------------- */
  function restoreFocus(focus) {
    if (!focus || !listEl) return;
    var row = findRow(focus.id);
    if (!row) return;
    var selector =
      focus.type === "select" ? ".w-select" :
      focus.type === "input" ? ".w-input" :
      focus.type === "score" ? ".w-score" :
      '[data-act="' + focus.act + '"]';
    var node = row.querySelector(selector);
    if (node) node.focus();
  }

  /** 完整记录 + 本次改动；PATCH 带上全部字段，避免 patch schema 的默认值覆盖未提交字段。 */
  function patchBody(item, changes) {
    var body = {
      bangumiId: item.bangumiId === undefined ? null : item.bangumiId,
      title: item.title,
      status: item.status,
      totalEps: item.totalEps,
      watchedEps: item.watchedEps,
      score: item.score === undefined ? null : item.score,
      nextAirAt: item.nextAirAt === undefined ? null : item.nextAirAt,
      coverKey: item.coverKey === undefined ? null : item.coverKey
    };
    for (var key in changes) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) body[key] = changes[key];
    }
    return body;
  }

  function mutate(id, payload, successText, focus) {
    if (state.busy[id]) return;
    var current = findItem(id);
    if (!current) return;
    state.busy[id] = true;
    lockRow(id);

    // 带上完整记录：后端 patch schema 只认识传进来的键，完整记录能保证没改的字段不被重置。
    api("PATCH", "/" + encodeURIComponent(id), patchBody(current, payload)).then(function (res) {
      return readJson(res).then(function (body) { return { res: res, body: body }; });
    }).then(function (result) {
      if (authFailure(result.res.status)) return;
      if (!result.res.ok) {
        var message = "HTTP " + result.res.status;
        if (result.res.status === 400 && result.body && result.body.issues && result.body.issues.length > 0) {
          message = result.body.issues[0].path + "：" + result.body.issues[0].message;
        }
        toast("保存失败 · " + message);
        return;
      }
      var item = result.body ? result.body.item : null;
      if (!item) throw new Error("missing_item");
      updateItem(item);
      toast(successText(item));
      hideBanner();
    }).catch(function (error) {
      if (error && error.message === "missing_item") toast("保存失败 · 接口响应缺少 item");
      else toast("保存失败 · 网络或服务异常");
    }).then(function () {
      state.busy[id] = false;
      renderAll();
      restoreFocus(focus);
    });
  }

  function stepEps(id, delta) {
    var item = findItem(id);
    if (!item) return;
    var progress = progressOf(item);
    var max = progress.total > 0 ? progress.total : MAX_EPS;
    var next = Math.min(max, Math.max(0, progress.watched + delta));
    if (next === progress.watched) {
      toast(delta > 0 ? "已经是最后一话" : "已经是最前面一话");
      return;
    }
    mutate(id, { watchedEps: next }, function (updated) {
      var after = progressOf(updated);
      return "《" + updated.title + "》进度已更新 · " + after.epText;
    }, { id: id, type: "act", act: delta > 0 ? "plus" : "minus" });
  }

  function saveEps(id, raw) {
    var item = findItem(id);
    if (!item) return;
    var progress = progressOf(item);
    var value = Number(raw);
    var invalid =
      raw === "" ||
      !Number.isInteger(value) ||
      value < 0 ||
      (progress.total > 0 && value > progress.total);
    if (invalid) {
      toast(progress.total > 0 ? "已看集数需要是 0 到 " + progress.total + " 的整数" : "已看集数需要是非负整数");
      renderAll();
      return;
    }
    if (value === progress.watched) {
      renderAll();
      return;
    }
    mutate(id, { watchedEps: value }, function (updated) {
      return "《" + updated.title + "》进度已保存 · " + progressOf(updated).epText;
    }, { id: id, type: "input" });
  }

  function saveStatus(id, status) {
    var item = findItem(id);
    if (!item || !STATUS[status]) return;
    if (status === item.status) {
      renderAll();
      return;
    }
    mutate(id, { status: status }, function (updated) {
      return "《" + updated.title + "》状态改为 " + STATUS[updated.status].label;
    }, { id: id, type: "select" });
  }

  function saveScore(id, raw) {
    var item = findItem(id);
    if (!item) return;
    if (raw === "") {
      if (item.score === null) {
        renderAll();
        return;
      }
      mutate(id, { score: null }, function (updated) {
        return "《" + updated.title + "》评分已清空";
      }, { id: id, type: "score" });
      return;
    }
    var value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      toast("评分需要是 0 到 10 的整数");
      renderAll();
      return;
    }
    if (item.score === value) {
      renderAll();
      return;
    }
    mutate(id, { score: value }, function (updated) {
      return "《" + updated.title + "》评分改为 " + scoreText(updated.score);
    }, { id: id, type: "score" });
  }

  /* ---------------- 删除 ---------------- */
  function askDelete(id) {
    var item = findItem(id);
    if (!item) return;
    if (!canWrite()) return;
    pendingDeleteId = id;
    setText(cfmText, "确定删除《" + item.title + "》？记录会立即从 D1 删除，前台 /bangumi 不再显示，且不可撤销。");
    if (cfmDlg && typeof cfmDlg.showModal === "function") {
      cfmDlg.showModal();
    } else if (window.confirm("确定删除《" + item.title + "》？删除后不可撤销。")) {
      deleteItem(id);
    }
  }

  function deleteItem(id) {
    var item = findItem(id);
    if (!item || state.busy[id]) return;
    state.busy[id] = true;
    lockRow(id);
    api("DELETE", "/" + encodeURIComponent(id)).then(function (res) {
      return readJson(res).then(function (body) { return { res: res, body: body }; });
    }).then(function (result) {
      if (authFailure(result.res.status)) return;
      if (!result.res.ok) {
        toast("删除失败 · HTTP " + result.res.status);
        return;
      }
      state.items = state.items.filter(function (row) { return row.id !== id; });
      toast("已删除《" + item.title + "》");
    }).catch(function () {
      toast("删除失败 · 网络或服务异常");
    }).then(function () {
      state.busy[id] = false;
      renderAll();
    });
  }

  /* ---------------- 同步 ---------------- */
  function setSyncBusy(busy) {
    state.syncing = busy;
    if (syncbar) syncbar.classList.toggle("is-syncing", busy);
    each([syncBtn, syncMain], function (button) {
      if (!button) return;
      button.disabled = busy;
      if (busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
    setText(syncBtnLabel, busy ? "同步中…" : "立即同步");
    setText(syncMainLabel, busy ? "同步中…" : "同步 Bangumi");
  }

  function sync() {
    if (state.syncing) return;
    if (!canWrite()) return;
    setSyncBusy(true);
    setText(syncState, "正在同步…");
    setText(syncResult, "正在请求 Bangumi 收藏并写入 D1…");
    setText(syncMeta, "BANGUMI API · 手动同步");

    api("POST", "/sync").then(function (res) {
      return readJson(res).then(function (body) { return { res: res, body: body }; });
    }).then(function (result) {
      if (authFailure(result.res.status)) return;
      var body = result.body || {};
      if (!result.res.ok || body.ok !== true) {
        var reason = body.reason || "HTTP " + result.res.status;
        setText(syncState, "同步失败 · " + reason);
        setText(syncResult, "Bangumi 接口未返回成功（" + reason + "），请检查 BANGUMI_ACCESS_TOKEN 与网络。");
        toast("同步失败 · " + reason);
        return;
      }
      if (body.reason === "not_configured") {
        setText(syncState, "已跳过 · 未配置令牌");
        setText(syncResult, "未配置 BANGUMI_ACCESS_TOKEN，已跳过本次同步（没有写入任何记录）。");
        toast("未配置 BANGUMI_ACCESS_TOKEN，已跳过同步");
        return;
      }
      var synced = typeof body.synced === "number" ? body.synced : 0;
      setText(syncState, "同步完成 · 写入 " + synced + " 条");
      setText(syncResult, "Bangumi 收藏已同步 · " + synced + " 条记录写入 D1");
      toast("同步完成 · " + synced + " 条记录已写入 D1");
      hideBanner();
      loadItems(true);
    }).catch(function () {
      setText(syncState, "同步失败 · 网络异常");
      setText(syncResult, "请求后台接口失败，请检查网络或稍后重试。");
      toast("同步失败 · 网络异常");
    }).then(function () {
      setSyncBusy(false);
      setText(syncMeta, "BANGUMI API · 上次尝试 今天 " + clockNow());
    });
  }

  /* ---------------- 加载列表 ---------------- */
  function loadItems(quiet) {
    if (!API_URL) {
      state.loading = false;
      state.authorized = false;
      showBanner("error", "页面缺少后台接口地址", "后台页面需要通过 data-api 传入接口地址。", false);
      setPageState("配置错误 · 缺少接口地址");
      renderAll();
      return;
    }
    if (!state.token) {
      state.loading = false;
      state.authorized = false;
      if (!quiet) {
        showBanner("info", "尚未填写管理令牌", "后台接口需要 x-admin-token。令牌只存在本机 localStorage：到「设置」页填入 ADMIN_TOKEN（本地开发是 dev-admin-token）后刷新本页。", true);
        setPageState("未连接 · 未填写管理令牌");
      }
      renderAll();
      return;
    }

    if (!quiet) {
      state.loading = true;
      setPageState("正在读取 D1…");
      renderAll();
    }

    api("GET", "").then(function (res) {
      return readJson(res).then(function (body) { return { res: res, body: body }; });
    }).then(function (result) {
      state.loading = false;
      if (authFailure(result.res.status)) {
        state.items = [];
        renderAll();
        return;
      }
      if (!result.res.ok) {
        state.authorized = false;
        state.items = [];
        showBanner("error", "读取追番记录失败（HTTP " + result.res.status + "）", "稍后重试；问题持续时查看 Worker 日志。", false);
        setPageState("读取失败 · HTTP " + result.res.status);
        renderAll();
        return;
      }
      state.items = result.body && Array.isArray(result.body.items) ? result.body.items : [];
      state.authorized = true;
      hideBanner();
      setPageState("已连接 · 最近读取 " + clockNow());
      renderAll();
    }).catch(function () {
      state.loading = false;
      state.authorized = false;
      state.items = [];
      showBanner("error", "无法连接后台接口", "网络或服务端异常，请稍后重试。", false);
      setPageState("连接失败");
      renderAll();
    });
  }

  /* ---------------- 导出 ---------------- */
  function exportRecords() {
    if (!state.authorized || state.items.length === 0) {
      toast("没有可导出的记录");
      return;
    }
    var payload = {
      source: "d1",
      exportedAt: new Date().toISOString(),
      items: state.items
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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

  /* ---------------- 事件 ---------------- */
  if (!listEl) return;

  listEl.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var button = target.closest("button[data-act]");
    if (!button || !listEl.contains(button)) return;
    var row = button.closest(".wrow");
    if (!row) return;
    var id = row.getAttribute("data-id");
    var action = button.getAttribute("data-act");
    if (action === "minus") stepEps(id, -1);
    else if (action === "plus") stepEps(id, 1);
    else if (action === "delete") askDelete(id);
  });

  listEl.addEventListener("change", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var row = target.closest(".wrow");
    if (!row) return;
    var id = row.getAttribute("data-id");
    if (target.classList.contains("w-input")) saveEps(id, target.value);
    else if (target.classList.contains("w-score")) saveScore(id, target.value);
    else if (target.classList.contains("w-select")) saveStatus(id, target.value);
  });

  if (syncBtn) syncBtn.addEventListener("click", sync);
  if (syncMain) syncMain.addEventListener("click", sync);
  if (exportBtn) exportBtn.addEventListener("click", exportRecords);

  if (cfmCancel) cfmCancel.addEventListener("click", function () { cfmDlg.close(); });
  if (cfmDlg) cfmDlg.addEventListener("click", function (event) {
    if (event.target === cfmDlg) cfmDlg.close();
  });
  if (cfmOk) cfmOk.addEventListener("click", function () {
    var id = pendingDeleteId;
    pendingDeleteId = null;
    cfmDlg.close();
    if (id) deleteItem(id);
  });

  /* ---------------- 初始化 ---------------- */
  renderAll();
  loadItems(false);
})();
