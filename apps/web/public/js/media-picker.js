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
         categoryId: "cat_posts",     // 可选；入口默认分类（上传归类用，可为空=未分类）
         sizes: ["480", "720", "1080", "1440", "orig"], // 可选；传了才显示尺寸栏
         defaultSize: "720",          // 尺寸栏默认高亮档位
         size: "720",                 // 初始选中档位（优先于 defaultSize）
         onPick: function (item, size) {} // item = MediaItem；size = 当前尺寸档位
       })

     分类筛选：现有图片顶部有「全部 + 动态分类 + 未分类」chips，列表与搜索都由服务端
     （文件名 / R2 key / 别名）完成。上传时归入「当前选中的具体分类 > 调用方 categoryId > 未分类」。
     分类/别名只存 D1，不改图片 URL。
     尺寸档位来自页面 data-image-sizes（@myon/shared 的 mediaImageSizes），
     不传 sizes 时整条尺寸栏隐藏，行为与旧版一致（设置页 / 关于页）。
     图片处理复用 /js/image-upload.js（MyonImageUpload.prepareImage），
     令牌仍是顶栏的 localStorage['myon-admin-token']，这里只读不写。
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var PAGE_SIZE = 100;
  var MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  var UNCATEGORIZED = "uncategorized";
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
      // 分类 chips：全部 + 动态分类 + 未分类（浅色弹窗里用 .mp-cats 配色）
      '<div class="mp-cats" id="mpCats" role="group" aria-label="按分类筛选"></div>' +
      '<label class="mp-search"><span class="sr-only">搜索文件名或别名</span>' +
      '<input id="mpSearch" type="search" autocomplete="off" spellcheck="false"></label>' +
      '<div class="mp-grid" id="mpGrid" aria-busy="true"></div>' +
      '<p class="mp-empty" id="mpEmpty" hidden>媒体库还是空的，切到「上传新图」传一张。</p>' +
      '<div class="mp-foot"><span id="mpCount">—</span>' +
      '<button class="mp-more" id="mpMore" type="button" hidden>加载更多</button></div>' +
      "</div>" +
      '<div class="mp-pane" id="mpUploadPane" role="tabpanel" aria-label="上传新图" hidden>' +
      '<input type="file" id="mpFile" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml" multiple hidden>' +
      '<button class="p-btn" id="mpPickFile" type="button">选择文件上传 ＋</button>' +
      '<p class="mp-hint" id="mpUploadHint">JPG / PNG 自动转 WebP · GIF 转 animated WebP · WebP / AVIF / SVG 直传 · 单张上限 8MB</p>' +
      '<div class="mp-up-list" id="mpUpList" aria-live="polite"></div>' +
      "</div>" +
      '<div class="notice notice--warn mp-notice" id="mpNotice" hidden>' +
      '<span class="notice-k">WARN</span>' +
      '<div class="notice-c"><b>需要管理令牌</b><p>读取媒体库和上传图片都要先在顶栏填写「管理令牌」。</p></div>' +
      '<button class="notice-btn" type="button" data-token-open>管理令牌</button>' +
      "</div>" +
      // 尺寸栏：不传 sizes 的调用（设置页 / 关于页）整条隐藏，保持旧行为。
      '<div class="mp-size" id="mpSize" hidden>' +
      '<div class="mp-size-row"><span class="mp-size-k">尺寸</span>' +
      '<div class="mp-size-opts" id="mpSizeOpts" role="radiogroup" aria-label="图片尺寸"></div></div>' +
      '<p class="mp-size-hint">长边像素 · 默认 720px</p>' +
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
      cats: document.getElementById("mpCats"),
      grid: document.getElementById("mpGrid"),
      empty: document.getElementById("mpEmpty"),
      count: document.getElementById("mpCount"),
      more: document.getElementById("mpMore"),
      file: document.getElementById("mpFile"),
      pickFile: document.getElementById("mpPickFile"),
      uploadHint: document.getElementById("mpUploadHint"),
      upList: document.getElementById("mpUpList"),
      notice: document.getElementById("mpNotice"),
      sizeBar: document.getElementById("mpSize"),
      sizeOpts: document.getElementById("mpSizeOpts"),
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

  /** 选择器网格的缩略图：站内低清预览（size=320&q=70），外链原样。 */
  function previewSrc(item) {
    var src = mediaSrc(item);
    var image = window.MyonImage;
    return image && typeof image.preview === "function"
      ? image.preview(src, 320)
      : src;
  }

  /** 尺寸档位文案：orig →「原图」，数字原样。 */
  function sizeLabel(size) {
    var image = window.MyonImage;
    if (image && typeof image.label === "function") return image.label(size);
    return String(size) === "orig" ? "原图" : String(size);
  }

  /** 当前选中的尺寸：没传 sizes 的调用返回空串（回调第二参为 undefined）。 */
  function activeSize() {
    return state && state.sizes && state.sizes.length ? state.size : "";
  }

  function categoryNameById(id) {
    if (!id) return "未分类";
    for (var i = 0; i < state.categories.length; i += 1) {
      if (state.categories[i].id === id) return state.categories[i].name;
    }
    return "未分类";
  }

  /** 分类 chips：全部 + 动态分类（含计数）+ 未分类；浅色弹窗专用样式 .mp-cat。 */
  function paintCats() {
    if (!refs || !refs.cats) return;
    refs.cats.innerHTML = "";
    var entries = [{ id: "all", name: "全部", count: state.allCount }];
    for (var i = 0; i < state.categories.length; i += 1) {
      entries.push({
        id: state.categories[i].id,
        name: state.categories[i].name,
        count: state.categories[i].count || 0
      });
    }
    entries.push({ id: UNCATEGORIZED, name: "未分类", count: state.uncategorizedCount });
    var frag = document.createDocumentFragment();
    for (var j = 0; j < entries.length; j += 1) {
      var entry = entries[j];
      var btn = el("button", "mp-cat" + (state.category === entry.id ? " is-on" : ""));
      btn.type = "button";
      btn.setAttribute("data-category", entry.id);
      btn.setAttribute("aria-pressed", state.category === entry.id ? "true" : "false");
      btn.appendChild(document.createTextNode(entry.name));
      if (state.catCountsReady) {
        var count = el("b", "");
        count.textContent = String(entry.count);
        btn.appendChild(count);
      }
      btn.addEventListener("click", (function (target) {
        return function () {
          if (state.category === target.id) return;
          state.category = target.id;
          paintCats();
          updateUploadHint();
          loadMedia(true);
        };
      })(entry));
      frag.appendChild(btn);
    }
    refs.cats.appendChild(frag);
  }

  /** 上传归类：优先当前选中的具体分类，其次 opts.categoryId，最后未分类。 */
  function uploadCategoryId() {
    if (state.category !== "all" && state.category !== UNCATEGORIZED) return state.category;
    return state.entryCategoryId || "";
  }

  function updateUploadHint() {
    if (!refs || !refs.uploadHint) return;
    var id = uploadCategoryId();
    var name = id ? categoryNameById(id) : "未分类";
    refs.uploadHint.textContent =
      "上传后归入「" + name + "」分类 · JPG / PNG 自动转 WebP · GIF 转 animated WebP · WebP / AVIF / SVG 直传 · 单张上限 8MB";
  }

  function paintSizes() {
    if (!refs || !refs.sizeBar || !refs.sizeOpts) return;
    if (!state.sizes || !state.sizes.length) {
      refs.sizeBar.hidden = true;
      refs.sizeOpts.innerHTML = "";
      return;
    }
    refs.sizeBar.hidden = false;
    refs.sizeOpts.innerHTML = "";
    var frag = document.createDocumentFragment();
    state.sizes.forEach(function (size) {
      var btn = el(
        "button",
        "mp-size-btn" + (size === state.size ? " is-on" : ""),
        sizeLabel(size)
      );
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", size === state.size ? "true" : "false");
      btn.setAttribute("data-size", size);
      btn.title =
        String(size) === "orig" ? "保持原图尺寸" : "长边 " + size + "px";
      // 点选只切换高亮，真正的取值在点击图片 / 上传成功时随 onPick 回传。
      btn.addEventListener("click", function () {
        selectSize(size);
      });
      frag.appendChild(btn);
    });
    refs.sizeOpts.appendChild(frag);
  }

  function selectSize(size) {
    if (!state || !size) return;
    state.size = size;
    if (!refs || !refs.sizeOpts) return;
    var buttons = refs.sizeOpts.querySelectorAll(".mp-size-btn");
    Array.prototype.forEach.call(buttons, function (btn) {
      var on = btn.getAttribute("data-size") === size;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function renderGrid() {
    refs.grid.innerHTML = "";
    var frag = document.createDocumentFragment();
    state.items.forEach(function (item) {
      var btn = el("button", "mp-item");
      btn.type = "button";
      btn.setAttribute("data-key", item.key);
      btn.setAttribute("data-name", imageName(item));
      btn.setAttribute("data-category-id", item.categoryId || "");
      var aliases = Array.isArray(item.aliases) ? item.aliases : [];
      var catName = item.categoryName || "未分类";
      var title = imageName(item) + " · " + catName + " · " + formatSize(item.size);
      if (aliases.length) title += " · 别名：" + aliases.join("、");
      btn.title = title;
      if (state.selectedKey && item.key === state.selectedKey) btn.classList.add("is-on");
      var img = document.createElement("img");
      img.src = previewSrc(item);
      img.alt = imageName(item);
      img.loading = "lazy";
      img.decoding = "async";
      btn.appendChild(img);
      btn.appendChild(el("span", "mp-item-name", imageName(item)));
      if (aliases.length) {
        // 副行展示别名，方便按记忆里的短名找图
        btn.appendChild(el("span", "mp-item-name", aliases.join(" · ")));
      }
      btn.addEventListener("click", function () {
        pick(item);
      });
      frag.appendChild(btn);
    });
    refs.grid.appendChild(frag);

    if (state.items.length === 0) {
      refs.empty.hidden = false;
      refs.empty.textContent = state.q || state.category !== "all"
        ? "没有匹配的图片。换个关键词或分类试试。"
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
    if (!state) return;
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
    var url = state.api + "?limit=" + PAGE_SIZE + "&offset=" + state.offset;
    if (state.category && state.category !== "all") {
      url += "&category=" + encodeURIComponent(state.category);
    }
    if (state.q) url += "&q=" + encodeURIComponent(state.q);
    fetch(url, {
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
        // 分类列表随列表接口一起返回（含计数），首屏用它渲染 chips
        if (Array.isArray(result.body.categories)) {
          state.categories = result.body.categories.slice().sort(function (a, b) {
            return (a.position || 0) - (b.position || 0);
          });
          state.uncategorizedCount =
            typeof result.body.uncategorizedCount === "number"
              ? result.body.uncategorizedCount
              : 0;
          var allCount = state.uncategorizedCount;
          state.categories.forEach(function (cat) {
            allCount += typeof cat.count === "number" ? cat.count : 0;
          });
          state.allCount = allCount;
          state.catCountsReady = true;
          paintCats();
          updateUploadHint();
        }
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
    var size = activeSize();
    state.selectedKey = item.key;
    if (typeof state.onPick === "function") state.onPick(item, size || undefined);
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

  function uploadXhr(file, categoryId, row) {
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
      if (categoryId) form.append("categoryId", categoryId);
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
    // 上传归类：当前选中具体分类 > 调用方 categoryId > 未分类
    var categoryId = uploadCategoryId();
    var queue = Array.prototype.slice.call(files);
    var uploaded = [];

    function next() {
      var file = queue.shift();
      if (!file) {
        state.busy = false;
        refs.pickFile.disabled = false;
        if (uploaded.length) {
          var size = activeSize();
          uploaded.forEach(function (item) {
            if (typeof state.onPick === "function")
              state.onPick(item, size || undefined);
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
          return uploadXhr(prepared, categoryId, row);
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
    // 尺寸档位：只在调用方传了非空数组时启用；默认高亮 720，初始选中优先用 size。
    var sizes = Array.isArray(opts.sizes) ? opts.sizes.slice() : [];
    var wanted = String(opts.size || opts.defaultSize || "720");
    if (sizes.length && sizes.indexOf(wanted) < 0) wanted = sizes[0];
    state = {
      mode: opts.mode === "pick" ? "pick" : "insert",
      api: opts.api || "",
      gifApi: opts.gifApi || "",
      base: opts.base || "/media/",
      selectedKey: opts.selectedKey || null,
      entryCategoryId: typeof opts.categoryId === "string" ? opts.categoryId : "",
      category: "all",
      categories: [],
      uncategorizedCount: 0,
      allCount: 0,
      catCountsReady: false,
      sizes: sizes.length ? sizes : null,
      size: sizes.length ? wanted : "",
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
    paintSizes();
    paintCats();
    updateUploadHint();
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
    // 搜索走服务端（文件名 / R2 key / 别名），输入 300ms 防抖
    var searchTimer = null;
    refs.search.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (!state) return;
        var next = refs.search.value.trim();
        if (next === state.q) return;
        state.q = next;
        loadMedia(true);
      }, 300);
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
