(function () {
  "use strict";

  /* ==========================================================================
     Myon · 后台共享图片选择器（媒体库「现有」+「上传」）

     用法：
       MyonMediaPicker.open({
         mode: "insert" | "pick",     // insert=插入 Markdown 图片语法；pick=取一张配图
         api: "/api/v1/admin/media",  // 媒体列表 / 上传接口
         gifApi: ".../media/gif-webp",// GIF 转码代理（可空）
         base: "/media/",             // 图片地址前缀，来自 mediaUrl()
         selectedKey: "uploads/xx",   // pick 模式下的已选图
         onPick: function (item) {}   // item = MediaItem { id, key, filename, mime, size, ... }
       })

     图片处理复用 /js/image-upload.js（MyonImageUpload.prepareImage），
     令牌仍是顶栏的 localStorage['myon-admin-token']，这里只读不写。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var PAGE_SIZE = 100;
  var MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  var UPLOAD_ERRORS = {
    unsupported_type: "仅支持 WebP / AVIF / SVG 最终文件",
    too_large: "转换后超过 8MB",
    empty_file: "文件为空",
    upload_failed: "服务端上传失败"
  };

  function readToken() {
    try {
      return (localStorage.getItem(TOKEN_KEY) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatSize(bytes) {
    var value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB";
    if (value >= 1024) return Math.round(value / 1024) + " KB";
    return value + " B";
  }

  function imageName(item) {
    return item && (item.filename || item.key) ? String(item.filename || item.key) : "图片";
  }

  var dlg = null;
  var refs = null;
  var state = null;

  /* ---------------- 弹窗骨架（静态结构，数据一律走 DOM API） ---------------- */
  function buildDialog() {
    if (dlg) return;
    dlg = document.createElement("dialog");
    dlg.className = "dlg mp-dlg";
    dlg.id = "mediaPickerDlg";
    dlg.setAttribute("aria-labelledby", "mpTitle");
    dlg.innerHTML =
      '<div class="dlg-box mp-box">' +
      '<span class="dlg-tab">MEDIA / 图片</span>' +
      '<div class="mp-head"><b class="mp-title" id="mpTitle">插入图片</b><span class="mp-state" id="mpState">—</span></div>' +
      '<div class="mp-tabs" role="tablist" aria-label="图片来源">' +
      '<button class="mp-tab is-on" id="mpTabExisting" type="button" role="tab" aria-selected="true">现有图片</button>' +
      '<button class="mp-tab" id="mpTabUpload" type="button" role="tab" aria-selected="false">上传新图</button>' +
      "</div>" +
      '<div class="mp-pane" id="mpExistingPane" role="tabpanel" aria-label="现有图片">' +
      '<label class="mp-search"><span class="sr-only">搜索图片文件名</span>' +
      '<input id="mpSearch" type="search" placeholder="搜索文件名" autocomplete="off" spellcheck="false"></label>' +
      '<div class="mp-grid" id="mpGrid" aria-busy="true"></div>' +
      '<p class="mp-empty" id="mpEmpty" hidden>媒体库还是空的，切到「上传新图」传一张。</p>' +
      '<div class="mp-foot"><span id="mpCount">—</span>' +
      '<button class="mp-more" id="mpMore" type="button" hidden>加载更多</button></div>' +
      "</div>" +
      '<div class="mp-pane" id="mpUploadPane" role="tabpanel" aria-label="上传新图" hidden>' +
      '<input type="file" id="mpFile" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml" multiple hidden>' +
      '<button class="p-btn" id="mpPickFile" type="button">选择文件上传 ＋</button>' +
      '<p class="mp-hint">JPG / PNG 自动转 WebP · GIF 转 animated WebP · WebP / AVIF / SVG 直传 · 单张上限 8MB</p>' +
      '<div class="mp-up-list" id="mpUpList" aria-live="polite"></div>' +
      "</div>" +
      '<div class="notice notice--warn mp-notice" id="mpNotice" hidden>' +
      '<span class="notice-k">WARN</span>' +
      '<div class="notice-c"><b>需要管理令牌</b><p>读取媒体库和上传图片都要先在顶栏填写「管理令牌」。</p></div>' +
      '<button class="notice-btn" type="button" data-token-open>管理令牌</button>' +
      "</div>" +
      '<div class="dlg-f"><span class="mp-selected" id="mpSelected">—</span>' +
      '<div class="dlg-a"><button class="p-btn" id="mpCancel" type="button">关闭</button></div></div>' +
      "</div>";
    document.body.appendChild(dlg);
    refs = {
      title: document.getElementById("mpTitle"),
      state: document.getElementById("mpState"),
      tabExisting: document.getElementById("mpTabExisting"),
      tabUpload: document.getElementById("mpTabUpload"),
      existingPane: document.getElementById("mpExistingPane"),
      uploadPane: document.getElementById("mpUploadPane"),
      search: document.getElementById("mpSearch"),
      grid: document.getElementById("mpGrid"),
      empty: document.getElementById("mpEmpty"),
      count: document.getElementById("mpCount"),
      more: document.getElementById("mpMore"),
      file: document.getElementById("mpFile"),
      pickFile: document.getElementById("mpPickFile"),
      upList: document.getElementById("mpUpList"),
      notice: document.getElementById("mpNotice"),
      selected: document.getElementById("mpSelected"),
      cancel: document.getElementById("mpCancel")
    };
    bindEvents();
  }

  function setTab(name) {
    var existing = name !== "upload";
    refs.tabExisting.classList.toggle("is-on", existing);
    refs.tabUpload.classList.toggle("is-on", !existing);
    refs.tabExisting.setAttribute("aria-selected", existing ? "true" : "false");
    refs.tabUpload.setAttribute("aria-selected", existing ? "false" : "true");
    refs.existingPane.hidden = !existing;
    refs.uploadPane.hidden = existing;
    if (existing) refs.search.focus();
  }

  function paintNotice() {
    refs.notice.hidden = !!state.token;
  }

  function paintSelected() {
    var label = "—";
    if (state.selectedKey) {
      var matched = null;
      for (var i = 0; i < state.items.length; i += 1) {
        if (state.items[i].key === state.selectedKey) {
          matched = state.items[i];
          break;
        }
      }
      label = "已选：" + (matched ? imageName(matched) : state.selectedKey);
    }
    refs.selected.textContent = label;
  }

  function mediaSrc(item) {
    return String(state.base || "/media/") + item.key;
  }

  function renderGrid() {
    var q = state.q.trim().toLowerCase();
    var items = state.items.filter(function (item) {
      if (!q) return true;
      return imageName(item).toLowerCase().indexOf(q) >= 0;
    });

    refs.grid.innerHTML = "";
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      var btn = el("button", "mp-item");
      btn.type = "button";
      btn.setAttribute("data-key", item.key);
      btn.setAttribute("data-name", imageName(item));
      btn.title = imageName(item) + " · " + formatSize(item.size);
      if (state.selectedKey && item.key === state.selectedKey) btn.classList.add("is-on");
      var img = document.createElement("img");
      img.src = mediaSrc(item);
      img.alt = imageName(item);
      img.loading = "lazy";
      img.decoding = "async";
      btn.appendChild(img);
      btn.appendChild(el("span", "mp-item-name", imageName(item)));
      btn.addEventListener("click", function () {
        pick(item);
      });
      frag.appendChild(btn);
    });
    refs.grid.appendChild(frag);

    if (items.length === 0) {
      refs.empty.hidden = false;
      refs.empty.textContent = state.items.length
        ? "没有匹配「" + state.q.trim() + "」的图片。"
        : "媒体库还是空的，切到「上传新图」传一张。";
    } else {
      refs.empty.hidden = true;
    }
    refs.count.textContent =
      state.items.length + (state.total > state.items.length ? " / " + state.total : "") + " 张";
    refs.more.hidden = !(state.items.length < state.total);
    paintSelected();
  }

  function describeError(status, body) {
    var code = body && body.error;
    if (code && UPLOAD_ERRORS[code]) return UPLOAD_ERRORS[code];
    if (code === "invalid_json" || code === "invalid_form") return "服务端没有收到有效图片";
    if (status === 401) return "管理令牌无效";
    if (status === 503) return "服务端未配置管理令牌";
    return "请求失败（HTTP " + status + "）";
  }

  /* ---------------- 读取现有图片 ---------------- */
  function loadMedia(reset) {
    if (state.loading) return;
    if (!state.token) {
      state.items = [];
      state.total = 0;
      renderGrid();
      refs.state.textContent = "未连接";
      return;
    }
    if (reset) {
      state.items = [];
      state.total = 0;
      state.offset = 0;
    }
    state.loading = true;
    refs.grid.setAttribute("aria-busy", "true");
    refs.state.textContent = "读取中…";
    fetch(state.api + "?limit=" + PAGE_SIZE + "&offset=" + state.offset, {
      headers: { accept: "application/json", "x-admin-token": state.token },
      cache: "no-store"
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { response: response, body: body };
        });
      })
      .then(function (result) {
        if (result.response.status === 401) {
          state.token = "";
          paintNotice();
          throw new Error("管理令牌无效，请在顶栏更新");
        }
        if (!result.response.ok) {
          throw new Error(describeError(result.response.status, result.body));
        }
        var items = Array.isArray(result.body.items) ? result.body.items : [];
        state.items = state.items.concat(items);
        state.total = Number(result.body.total) || state.items.length;
        state.offset += items.length;
        refs.state.textContent = "已连接 · " + state.items.length + " / " + state.total;
      })
      .catch(function (error) {
        refs.state.textContent = (error && error.message) || "读取失败";
      })
      .then(function () {
        state.loading = false;
        refs.grid.removeAttribute("aria-busy");
        renderGrid();
      });
  }

  /* ---------------- 选择 / 上传 ---------------- */
  function pick(item) {
    if (!item || state.busy) return;
    state.selectedKey = item.key;
    if (typeof state.onPick === "function") state.onPick(item);
    closeDialog();
  }

  function addUploadRow(name) {
    var row = el("div", "mp-up-row");
    row.appendChild(el("span", "mp-up-name", name));
    var track = el("span", "mp-up-track");
    var fill = el("span", "mp-up-fill");
    track.appendChild(fill);
    row.appendChild(track);
    var status = el("span", "mp-up-st", "等待中");
    row.appendChild(status);
    row._fill = fill;
    row._status = status;
    refs.upList.appendChild(row);
    return row;
  }

  function setUploadRow(row, text, isError, pct) {
    row._status.textContent = text;
    if (typeof pct === "number") row._fill.style.width = pct + "%";
    row.classList.toggle("is-err", !!isError);
    row.classList.toggle("is-ok", !isError && text === "完成");
  }

  function uploadXhr(file, row) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", state.api, true);
      if (state.token) xhr.setRequestHeader("x-admin-token", state.token);
      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable) return;
        setUploadRow(row, "上传中 " + Math.round((event.loaded / event.total) * 100) + "%", false, Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = function () {
        reject(new Error("网络中断"));
      };
      xhr.onload = function () {
        var body = {};
        try {
          body = JSON.parse(xhr.responseText || "{}");
        } catch (error) {
          body = {};
        }
        if (xhr.status === 201 && body.item) {
          resolve(body.item);
          return;
        }
        reject(new Error(describeError(xhr.status, body)));
      };
      var form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    });
  }

  function handleFiles(files) {
    if (!files || !files.length || state.busy) return;
    if (!state.token) {
      paintNotice();
      setTab("upload");
      return;
    }
    var uploader = window.MyonImageUpload;
    if (!uploader) {
      refs.state.textContent = "图片处理组件未加载";
      return;
    }
    state.busy = true;
    refs.pickFile.disabled = true;
    var queue = Array.prototype.slice.call(files);
    var uploaded = [];

    function next() {
      var file = queue.shift();
      if (!file) {
        state.busy = false;
        refs.pickFile.disabled = false;
        if (uploaded.length) {
          uploaded.forEach(function (item) {
            if (typeof state.onPick === "function") state.onPick(item);
          });
          closeDialog();
        }
        return;
      }
      var row = addUploadRow(file.name || "图片");
      if (!file.size) {
        setUploadRow(row, "失败 · 文件为空", true);
        next();
        return;
      }
      if (file.size > MAX_SOURCE_BYTES) {
        setUploadRow(row, "失败 · 源文件超过 20MB", true);
        next();
        return;
      }
      setUploadRow(row, "转换中…");
      uploader
        .prepareImage(file, { gifApi: state.gifApi })
        .then(function (prepared) {
          if (prepared.size > MAX_UPLOAD_BYTES) throw new Error("转换后超过 8MB");
          return uploadXhr(prepared, row);
        })
        .then(function (item) {
          uploaded.push(item);
          state.items.unshift(item);
          state.total += 1;
          renderGrid();
          setUploadRow(row, "完成", false, 100);
        })
        .catch(function (error) {
          setUploadRow(row, "失败 · " + ((error && error.message) || "上传失败"), true);
        })
        .then(next);
    }

    next();
  }

  /* ---------------- 生命周期 ---------------- */
  function closeDialog() {
    if (dlg && dlg.open) dlg.close();
  }

  function open(opts) {
    buildDialog();
    opts = opts || {};
    state = {
      mode: opts.mode === "pick" ? "pick" : "insert",
      api: opts.api || "",
      gifApi: opts.gifApi || "",
      base: opts.base || "/media/",
      selectedKey: opts.selectedKey || null,
      onPick: typeof opts.onPick === "function" ? opts.onPick : null,
      token: readToken(),
      items: [],
      total: 0,
      offset: 0,
      q: "",
      loading: false,
      busy: false
    };
    refs.title.textContent = state.mode === "pick" ? "选择配图" : "插入图片";
    refs.search.value = "";
    refs.upList.innerHTML = "";
    refs.state.textContent = "—";
    refs.grid.innerHTML = "";
    paintNotice();
    paintSelected();
    setTab("existing");
    if (dlg.open) dlg.close();
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
    loadMedia(true);
  }

  function bindEvents() {
    refs.tabExisting.addEventListener("click", function () { setTab("existing"); });
    refs.tabUpload.addEventListener("click", function () { setTab("upload"); });
    refs.search.addEventListener("input", function () {
      state.q = refs.search.value;
      renderGrid();
    });
    refs.more.addEventListener("click", function () { loadMedia(false); });
    refs.cancel.addEventListener("click", closeDialog);
    refs.pickFile.addEventListener("click", function () { refs.file.click(); });
    refs.file.addEventListener("change", function () {
      handleFiles(refs.file.files);
      refs.file.value = "";
    });
    dlg.addEventListener("click", function (event) {
      if (event.target === dlg) closeDialog();
    });
    dlg.addEventListener("close", function () {
      state = null;
    });
  }

  window.MyonMediaPicker = { open: open };
})();
