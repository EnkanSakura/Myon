(function () {
  "use strict";

  /* ==========================================================================
     Myon · 后台共享图片选择器（媒体库「现有」+「上传」）

     用法：
       MyonMediaPicker.open({
         mode: "insert" | "pick",     // insert=插入 Markdown 图片语法；pick=选择配图
         api: "/api/v1/admin/media",  // 媒体列表 / 上传接口
         gifApi: ".../media/gif-webp",// GIF 转码代理（可空）
         base: "/media/",             // 图片地址前缀，来自 mediaUrl()
         multiple: false,             // 可选；true 时网格可多选
         selectedKey: "uploads/xx",   // 单选模式的已选图
         selectedKeys: ["uploads/a"], // 多选模式的已选图
         categoryId: "cat_posts",     // 可选；入口默认分类（上传归类用，可为空=未分类）
         sizes: ["480", "720", "1080", "1440", "orig"], // 可选；传了才显示尺寸栏
         defaultSize: "720",          // 尺寸栏默认高亮档位
         size: "720",                 // 初始选中档位（优先于 defaultSize）
         // 选择 / 上传后只更新勾选，点「确定」才回调；取消 / 关闭不应用。
         // 单选：onPick(item, size)；多选：onPick(items, size)。
         onPick: function (itemOrItems, size) {}
       })

     分类筛选：现有图片顶部有「全部 + 动态分类 + 未分类」chips。搜索语义与服务端一致
     （文件名 / R2 key / 别名），但请求按「分类 + 关键词」缓存 5 分钟：
       · 首次进入「现有图片」请求一次；
       · 同一筛选再访问、重复打开选择器直接用缓存，不再重复请求；
       · 首页已覆盖整库时，分类与搜索完全在本地筛选，零请求；
       · 库超过一页（PAGE_SIZE）时回退到服务端查询，保证筛选仍覆盖全库。
     上传成功或令牌失效会清空缓存；并发查询只应用最后一次的结果。
     上传时归入「当前选中的具体分类 > 调用方 categoryId > 未分类」。
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

  // 现有图片的查询缓存：选择器每次打开都会重建 state，但列表不必重新请求。
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var CACHE_MAX_ENTRIES = 20;

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
  /** 查询缓存：state 每次打开重建，缓存跨弹窗保留，直到 TTL 过期或上传后失效。 */
  var libraryCache = new Map();
  /** 整库快照：首页已覆盖全部文件时用它把分类 / 搜索改成本地筛选，不再请求后端。 */
  var completeSet = null;

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
      '<div class="dlg-a"><button class="p-btn" id="mpCancel" type="button">取消</button>' +
      '<button class="p-btn p-btn--pub" id="mpConfirm" type="button" disabled>确定</button></div></div>' +
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
      cancel: document.getElementById("mpCancel"),
      confirm: document.getElementById("mpConfirm")
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
    if (existing) {
      // 懒加载：首次切到「现有图片」才查询；重复打开选择器直接命中缓存，不再请求。
      if (state && !state.libraryLoaded && !state.loading) runQuery();
      refs.search.focus();
    } else if (state) {
      refs.pickFile.focus();
    }
  }

  function paintNotice() {
    refs.notice.hidden = !!state.token;
  }

  /** 按 key 找当前列表里的图；尚未加载到这一页时用 key 兜底，保证仍能确认。 */
  function itemForKey(key) {
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].key === key) return state.items[i];
    }
    return {
      id: key,
      key: key,
      filename: String(key).split("/").pop() || key,
      mime: "",
      size: 0,
      width: null,
      height: null,
      createdAt: "",
      categoryId: null,
      categoryName: null,
      aliases: []
    };
  }

  function paintSelected() {
    if (!refs || !refs.selected) return;
    var keys = state.pickedKeys || [];
    var label;
    if (keys.length === 0) {
      label = state.multiple ? "未选择图片（可多选）" : "未选择图片";
    } else if (state.multiple) {
      label = "已选 " + keys.length + " 张 · 点「确定」应用";
    } else {
      label = "已选：" + imageName(itemForKey(keys[0]));
    }
    refs.selected.textContent = label;
    if (refs.confirm) refs.confirm.disabled = keys.length === 0 || state.busy;
  }

  /** 网格勾选态：只切换 class / aria，不重建节点，避免缩略图重新加载。 */
  function paintGridSelection() {
    if (!refs || !refs.grid) return;
    var keys = state.pickedKeys || [];
    Array.prototype.forEach.call(
      refs.grid.querySelectorAll(".mp-item"),
      function (btn) {
        var on = keys.indexOf(btn.getAttribute("data-key")) >= 0;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
    );
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
    refs.cats.replaceChildren();
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
          runQuery();
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
    var prefix;
    if (!id) prefix = "上传后归入「未分类」";
    else if (state.catCountsReady) prefix = "上传后归入「" + categoryNameById(id) + "」";
    else prefix = "上传后归入栏目默认分类";
    refs.uploadHint.textContent =
      prefix + " · JPG / PNG 自动转 WebP · GIF 转 animated WebP · WebP / AVIF / SVG 直传 · 单张上限 8MB";
  }

  function paintSizes() {
    if (!refs || !refs.sizeBar || !refs.sizeOpts) return;
    if (!state.sizes || !state.sizes.length) {
      refs.sizeBar.hidden = true;
      refs.sizeOpts.replaceChildren();
      return;
    }
    refs.sizeBar.hidden = false;
    refs.sizeOpts.replaceChildren();
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
    refs.grid.replaceChildren();
    var frag = document.createDocumentFragment();
    state.items.forEach(function (item) {
      var btn = el("button", "mp-item");
      btn.type = "button";
      btn.setAttribute("data-key", item.key);
      btn.setAttribute("data-name", imageName(item));
      btn.setAttribute("data-category-id", item.categoryId || "");
      var picked = state.pickedKeys.indexOf(item.key) >= 0;
      btn.classList.toggle("is-on", picked);
      btn.setAttribute("aria-pressed", picked ? "true" : "false");
      var aliases = Array.isArray(item.aliases) ? item.aliases : [];
      var catName = item.categoryName || "未分类";
      var title = imageName(item) + " · " + catName + " · " + formatSize(item.size);
      if (aliases.length) title += " · 别名：" + aliases.join("、");
      btn.title = title;
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
        togglePick(item);
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

  /* ---------------- 读取现有图片：本地筛选 → 缓存 → 服务端 ---------------- */

  /** 查询键与 listMedia 的筛选参数一一对应；state 每次打开重建，缓存跨弹窗保留。 */
  function queryKey(category, q) {
    return JSON.stringify([category || "all", String(q || "").trim()]);
  }

  function cacheGet(key) {
    var entry = libraryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      libraryCache.delete(key);
      return null;
    }
    return entry;
  }

  function cacheSet(key, entry) {
    if (!libraryCache.has(key) && libraryCache.size >= CACHE_MAX_ENTRIES) {
      var oldestKey = null;
      var oldestAt = Infinity;
      libraryCache.forEach(function (value, name) {
        if (value.fetchedAt < oldestAt) {
          oldestAt = value.fetchedAt;
          oldestKey = name;
        }
      });
      if (oldestKey !== null) libraryCache.delete(oldestKey);
    }
    libraryCache.set(key, entry);
  }

  /** 上传成功 / 令牌失效后清空缓存，下一次查询回到服务端。 */
  function invalidateLibrary() {
    libraryCache.clear();
    completeSet = null;
  }

  /** 与 listMedia 的 itemCondition 一致：文件名、R2 key、别名任一命中。 */
  function keywordMatches(item, keyword) {
    var needle = keyword.toLowerCase();
    if (String(item.filename || "").toLowerCase().indexOf(needle) >= 0) return true;
    if (String(item.key || "").toLowerCase().indexOf(needle) >= 0) return true;
    var aliases = Array.isArray(item.aliases) ? item.aliases : [];
    for (var i = 0; i < aliases.length; i += 1) {
      if (String(aliases[i]).toLowerCase().indexOf(needle) >= 0) return true;
    }
    return false;
  }

  /**
   * 本地筛选：整库快照可用时成立（服务端同样是全库筛选，结果与再请求一次相同）。
   * 分类计数只应用关键词、不应用分类，与 listMedia 的 countWhere 保持一致。
   */
  function localQuery(category, q) {
    if (!completeSet || !Array.isArray(completeSet.categories)) return null;
    if (Date.now() - completeSet.fetchedAt > CACHE_TTL_MS) {
      completeSet = null;
      return null;
    }
    var keyword = String(q || "").trim();
    var matched = keyword
      ? completeSet.items.filter(function (item) {
          return keywordMatches(item, keyword);
        })
      : completeSet.items.slice();
    var counts = {};
    var uncategorizedCount = 0;
    matched.forEach(function (item) {
      if (item.categoryId) counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
      else uncategorizedCount += 1;
    });
    var categories = completeSet.categories.map(function (cat) {
      return {
        id: cat.id,
        name: cat.name,
        position: cat.position,
        count: counts[cat.id] || 0
      };
    });
    var items =
      !category || category === "all"
        ? matched
        : matched.filter(function (item) {
            return category === UNCATEGORIZED
              ? !item.categoryId
              : item.categoryId === category;
          });
    return {
      allItems: items,
      items: items.slice(0, PAGE_SIZE),
      total: items.length,
      categories: categories,
      uncategorizedCount: uncategorizedCount
    };
  }

  /** 把一次查询结果装进 state 并绘制；append=true 时接在现有列表后面。 */
  function applyResult(result, append) {
    if (Array.isArray(result.categories)) {
      state.categories = result.categories.toSorted(function (a, b) {
        return (a.position || 0) - (b.position || 0);
      });
      state.uncategorizedCount =
        typeof result.uncategorizedCount === "number" ? result.uncategorizedCount : 0;
      var allCount = state.uncategorizedCount;
      state.categories.forEach(function (cat) {
        allCount += typeof cat.count === "number" ? cat.count : 0;
      });
      state.allCount = allCount;
      state.catCountsReady = true;
      paintCats();
      updateUploadHint();
    }
    var items = Array.isArray(result.items) ? result.items : [];
    state.items = append ? state.items.concat(items) : items;
    state.total = Number(result.total) || state.items.length;
    state.libraryLoaded = true;
    state.loading = false;
    refs.grid.removeAttribute("aria-busy");
    refs.state.textContent = "已连接 · " + state.items.length + " / " + state.total;
    renderGrid();
  }

  /** 服务端查询一页；seq 丢弃过期响应，AbortController 取消被替换的请求。 */
  function fetchPage(offset, seq, append) {
    if (state.controller) state.controller.abort();
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    state.controller = controller;
    state.loading = true;
    if (!append) {
      // 有旧内容时只标记 refreshing，不清空列表；没有内容才显示读取中。
      refs.grid.setAttribute("aria-busy", "true");
      refs.state.textContent = state.items.length ? "刷新中…" : "读取中…";
    }
    var category = state.category;
    var q = state.q;
    var url = state.api + "?limit=" + PAGE_SIZE + "&offset=" + offset;
    if (category && category !== "all") {
      url += "&category=" + encodeURIComponent(category);
    }
    if (q) url += "&q=" + encodeURIComponent(q);
    fetch(url, {
      headers: { accept: "application/json", "x-admin-token": state.token },
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { response: response, body: body };
          });
      })
      .then(function (result) {
        // 用户已经换了查询：旧响应直接丢弃，不覆盖新的查询上下文。
        if (!state || state.seq !== seq) return;
        if (result.response.status === 401) {
          invalidateLibrary();
          state.token = "";
          state.loading = false;
          refs.grid.removeAttribute("aria-busy");
          paintNotice();
          refs.state.textContent = "管理令牌无效，请在顶栏更新";
          return;
        }
        if (!result.response.ok) {
          state.loading = false;
          refs.grid.removeAttribute("aria-busy");
          refs.state.textContent = describeError(result.response.status, result.body);
          return;
        }
        var page = {
          category: category,
          q: q,
          items: Array.isArray(result.body.items) ? result.body.items : [],
          total: Number(result.body.total) || 0,
          categories: Array.isArray(result.body.categories) ? result.body.categories : null,
          uncategorizedCount:
            typeof result.body.uncategorizedCount === "number"
              ? result.body.uncategorizedCount
              : 0,
          fetchedAt: Date.now()
        };
        if (offset === 0) {
          cacheSet(queryKey(category, q), page);
          // 首页已覆盖整库：之后分类 / 搜索都在本地完成，不再请求后端。
          if (
            Array.isArray(page.categories) &&
            (!category || category === "all") &&
            !String(q || "").trim() &&
            page.items.length >= page.total
          ) {
            completeSet = page;
          }
        } else {
          var cached = cacheGet(queryKey(category, q));
          if (cached) {
            cached.items = state.items.concat(page.items);
            cached.total = page.total;
            cached.fetchedAt = page.fetchedAt;
          }
        }
        state.localItems = null;
        applyResult(page, append);
      })
      .catch(function (error) {
        if (!state || state.seq !== seq) return;
        if (error && error.name === "AbortError") return;
        state.loading = false;
        refs.grid.removeAttribute("aria-busy");
        refs.state.textContent = (error && error.message) || "读取失败";
      });
  }

  /** 应用当前「分类 + 关键词」：本地筛选 → 查询缓存 → 服务端请求，逐级回退。 */
  function runQuery() {
    if (!state) return;
    var seq = ++state.seq;
    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }
    if (!state.token) {
      state.items = [];
      state.total = 0;
      state.localItems = null;
      state.loading = false;
      renderGrid();
      refs.state.textContent = "未连接";
      return;
    }
    var local = localQuery(state.category, state.q);
    if (local) {
      state.localItems = local.allItems;
      applyResult(local, false);
      return;
    }
    var cached = cacheGet(queryKey(state.category, state.q));
    if (cached) {
      state.localItems = null;
      applyResult(cached, false);
      return;
    }
    state.localItems = null;
    fetchPage(0, seq, false);
  }

  /** 「加载更多」：本地筛选结果直接切片，其余走服务端下一页。 */
  function loadMore() {
    if (!state || state.loading) return;
    if (state.localItems) {
      var next = state.localItems.slice(state.items.length, state.items.length + PAGE_SIZE);
      if (!next.length) return;
      state.items = state.items.concat(next);
      refs.state.textContent = "已连接 · " + state.items.length + " / " + state.total;
      renderGrid();
      return;
    }
    fetchPage(state.items.length, ++state.seq, true);
  }

  /* ---------------- 选择 / 上传 ---------------- */
  function togglePick(item) {
    if (!item || !item.key || state.busy) return;
    var index = state.pickedKeys.indexOf(item.key);
    if (state.multiple) {
      if (index >= 0) state.pickedKeys.splice(index, 1);
      else state.pickedKeys.push(item.key);
    } else {
      state.pickedKeys = [item.key];
    }
    paintGridSelection();
    paintSelected();
  }

  /** 只有点「确定」才回调并关闭；取消 / Esc / 点背景都不应用。 */
  function confirmPick() {
    if (!state || state.busy) return;
    var keys = state.pickedKeys.slice();
    if (!keys.length) return;
    var size = activeSize();
    if (typeof state.onPick === "function") {
      if (state.multiple) {
        state.onPick(keys.map(itemForKey), size || undefined);
      } else {
        state.onPick(itemForKey(keys[0]), size || undefined);
      }
    }
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
          // 上传成功后只更新勾选，切回「现有图片」让用户确认尺寸再点「确定」。
          if (state.multiple) {
            uploaded.forEach(function (item) {
              if (state.pickedKeys.indexOf(item.key) < 0)
                state.pickedKeys.push(item.key);
            });
          } else {
            state.pickedKeys = [uploaded[uploaded.length - 1].key];
          }
          paintSelected();
          paintGridSelection();
          setTab("existing");
        } else {
          paintSelected();
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
          // 库里多了一张图：缓存与整库快照都失效，下一次查询回到服务端。
          state.localItems = null;
          invalidateLibrary();
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
    var multiple = !!opts.multiple;
    var pickedKeys = Array.isArray(opts.selectedKeys)
      ? opts.selectedKeys.filter(function (key) {
          return typeof key === "string" && key.length > 0;
        })
      : [];
    if (!pickedKeys.length && opts.selectedKey) {
      pickedKeys = [String(opts.selectedKey)];
    }
    pickedKeys = multiple ? pickedKeys : pickedKeys.slice(0, 1);
    state = {
      mode: opts.mode === "pick" ? "pick" : "insert",
      multiple: multiple,
      api: opts.api || "",
      gifApi: opts.gifApi || "",
      base: opts.base || "/media/",
      pickedKeys: pickedKeys,
      entryCategoryId: typeof opts.categoryId === "string" ? opts.categoryId : "",
      category: "all",
      categories: [],
      uncategorizedCount: 0,
      allCount: 0,
      catCountsReady: false,
      libraryLoaded: false,
      sizes: sizes.length ? sizes : null,
      size: sizes.length ? wanted : "",
      onPick: typeof opts.onPick === "function" ? opts.onPick : null,
      token: readToken(),
      items: [],
      total: 0,
      // 本地筛选结果：整库已载时由 localQuery() 给出，「加载更多」从它切片
      localItems: null,
      // 请求序号与控制器：并发查询只应用最后一次的结果
      seq: 0,
      controller: null,
      q: "",
      loading: false,
      busy: false
    };
    refs.title.textContent =
      state.mode === "pick"
        ? state.multiple
          ? "选择配图（可多选）"
          : "选择配图"
        : "插入图片";
    refs.search.value = "";
    refs.upList.replaceChildren();
    refs.state.textContent = "—";
    refs.grid.replaceChildren();
    paintSizes();
    paintCats();
    updateUploadHint();
    paintNotice();
    paintSelected();
    setTab("upload");
    if (dlg.open) dlg.close();
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
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
        runQuery();
      }, 300);
    });
    refs.more.addEventListener("click", loadMore);
    refs.cancel.addEventListener("click", closeDialog);
    refs.confirm.addEventListener("click", confirmPick);
    refs.pickFile.addEventListener("click", function () { refs.file.click(); });
    refs.file.addEventListener("change", function () {
      handleFiles(refs.file.files);
      refs.file.value = "";
    });
    dlg.addEventListener("close", function () {
      // 中止未完成的请求，缓存保留给下一次打开。
      if (state && state.controller) state.controller.abort();
      state = null;
    });
  }

  window.MyonMediaPicker = { open: open };
})();
