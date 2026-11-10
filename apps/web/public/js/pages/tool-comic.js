(function () {
  "use strict";

  /* ==========================================================================
     工具 · 漫画下载（Champion Cross）
     - 服务端解析章节列表与页码（/api/v1/tools/comics/*），图片经站内中转拿回；
     - 图片如果被 4x4 打乱，在 canvas 里还原；
     - 所有页面只在本机打包成 ZIP，不上传服务器、不写 D1/R2。
     ========================================================================== */

  var root = document.getElementById("comicTool");
  if (!root) return;

  var ZIP = window.MyonComicZip;
  var UNSCRAMBLE = window.MyonComicUnscramble;
  if (!ZIP || !UNSCRAMBLE) return;

  var API = (root.getAttribute("data-api") || "/api/v1").replace(/\/+$/, "");
  var EPISODE_BASE = "https://championcross.jp/episodes/";
  var IMAGE_CONCURRENCY = 4;
  var MAX_PAGES_PER_REQUEST = 500;
  var UPSTREAM_HINT =
    "解析需要服务器能直连 championcross；该站目前限制数据中心网络访问，部署后也可能返回同样错误。";

  function byId(id) {
    return document.getElementById(id);
  }

  var els = {
    platform: byId("comicPlatform"),
    url: byId("comicUrl"),
    resolve: byId("comicResolve"),
    error: byId("comicError"),
    errorText: byId("comicErrorText"),
    result: byId("comicResult"),
    series: byId("comicSeries"),
    episode: byId("comicEpisode"),
    presets: Array.prototype.slice.call(document.querySelectorAll(".comic-preset")),
    selected: byId("comicSelected"),
    chapters: byId("comicChapters"),
    combine: byId("comicCombine"),
    download: byId("comicDownload"),
    cancel: byId("comicCancel"),
    progress: byId("comicProgress"),
    progressLabel: byId("comicProgressLabel"),
    progressPages: byId("comicProgressPages"),
    progressFill: byId("comicProgressFill"),
    done: byId("comicDone"),
    doneText: byId("comicDoneText"),
  };

  var state = {
    platforms: [],
    platform: "",
    phase: "idle", // idle | resolving | downloading
    resolved: null,
    selected: Object.create(null),
    cancelled: false,
  };

  function busy() {
    return state.phase !== "idle";
  }

  function pad(value, width) {
    var text = String(value);
    while (text.length < width) {
      text = "0" + text;
    }
    return text;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function selectedFreeChapters() {
    var chapters = (state.resolved && state.resolved.chapters) || [];
    return chapters.filter(function (chapter) {
      return chapter.free && state.selected[chapter.id];
    });
  }

  /* ---------------- 接口 ---------------- */

  /** 请求站内 API；失败时把 { error: 'code' } 转成 Error(code)。 */
  function apiRequest(path, options) {
    return fetch(API + path, options).then(function (response) {
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (payload) {
          if (!response.ok) {
            var code = payload && payload.error ? String(payload.error) : "http_" + response.status;
            throw new Error(code);
          }
          return payload;
        });
    });
  }

  function friendlyError(code) {
    var text = String(code || "");
    if (text.indexOf("invalid_episode_url") !== -1) {
      return "链接格式不正确，请粘贴 championcross 的章节页地址";
    }
    if (text.indexOf("chapter_not_free") !== -1) {
      return "该章节当前不可免费阅读，无法下载";
    }
    if (text.indexOf("upstream_unavailable") !== -1 || /championcross (page|api) \d+/i.test(text)) {
      return "无法访问 championcross（网络受限或站点维护），请稍后重试。";
    }
    return text || "请求失败，请稍后重试";
  }

  /* ---------------- 界面状态 ---------------- */

  function showError(message) {
    if (!els.error || !els.errorText) return;
    els.errorText.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    if (!els.error) return;
    els.error.hidden = true;
    if (els.errorText) els.errorText.textContent = "";
  }

  function hideResult() {
    if (els.result) els.result.hidden = true;
  }

  function hideDone() {
    if (!els.done) return;
    els.done.hidden = true;
    if (els.doneText) els.doneText.textContent = "";
  }

  function showDone(message) {
    if (!els.done || !els.doneText) return;
    els.doneText.textContent = message;
    els.done.hidden = false;
  }

  function updateSelected() {
    var chapters = (state.resolved && state.resolved.chapters) || [];
    var count = selectedFreeChapters().length;
    if (els.selected) {
      els.selected.textContent = "已选 " + count + " / " + chapters.length + " 话";
    }
    syncUi();
  }

  function syncUi() {
    var busyNow = busy();
    var count = selectedFreeChapters().length;

    if (els.resolve) {
      els.resolve.disabled = busyNow || !state.platform;
      els.resolve.textContent = state.phase === "resolving" ? "解析中…" : "解析";
    }
    if (els.platform) els.platform.disabled = busyNow || state.platforms.length === 0;
    if (els.url) els.url.disabled = busyNow;
    els.presets.forEach(function (button) {
      button.disabled = busyNow || !state.resolved;
    });
    if (els.combine) els.combine.disabled = busyNow;
    if (els.download) {
      els.download.disabled = busyNow || count === 0;
      els.download.textContent =
        state.phase === "downloading" ? "下载中…" : count > 0 ? "下载所选 · " + count + " 话" : "下载所选";
    }
    if (els.cancel) {
      els.cancel.hidden = state.phase !== "downloading";
      if (state.phase !== "downloading") els.cancel.disabled = false;
    }

    var boxes = els.chapters ? els.chapters.querySelectorAll(".cc-box") : [];
    Array.prototype.forEach.call(boxes, function (box) {
      box.disabled = busyNow || box.getAttribute("data-free") !== "1";
    });
  }

  function setProgress(current, total, title, done, pageTotal, fallback) {
    if (!els.progress) return;
    els.progress.hidden = false;
    if (els.progressLabel) {
      els.progressLabel.textContent = "[" + current + "/" + total + "] " + title;
    }
    if (els.progressPages) {
      els.progressPages.textContent = pageTotal
        ? done + " / " + pageTotal + " 页"
        : fallback || "获取页面中…";
    }
    if (els.progressFill) {
      var percent = pageTotal ? Math.round((done / pageTotal) * 100) : 8;
      els.progressFill.style.width = Math.max(8, percent) + "%";
    }
  }

  /* ---------------- 章节列表 ---------------- */

  function badge(text, className) {
    var node = document.createElement("span");
    node.className = "cc-badge " + className;
    node.textContent = text;
    return node;
  }

  function renderChapters() {
    if (!els.chapters) return;
    els.chapters.textContent = "";
    var chapters = (state.resolved && state.resolved.chapters) || [];

    chapters.forEach(function (chapter) {
      var item = document.createElement("li");
      item.className = "comic-chapter" + (chapter.free ? "" : " is-locked");

      var label = document.createElement("label");
      label.className = "cc-row";

      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "cc-box";
      box.checked = !!state.selected[chapter.id];
      box.disabled = !chapter.free || busy();
      box.setAttribute("data-free", chapter.free ? "1" : "0");
      box.setAttribute("data-id", chapter.id);
      box.setAttribute("aria-label", chapter.title || chapter.id);
      box.addEventListener("change", function () {
        if (!chapter.free) {
          box.checked = false;
          return;
        }
        if (box.checked) {
          state.selected[chapter.id] = true;
        } else {
          delete state.selected[chapter.id];
        }
        updateSelected();
      });

      var title = document.createElement("span");
      title.className = "cc-title";
      title.textContent = chapter.title || chapter.id;

      label.appendChild(box);
      label.appendChild(title);
      if (chapter.current) label.appendChild(badge("当前", "is-current"));
      label.appendChild(badge(chapter.free ? "免费" : "需付费", chapter.free ? "is-free" : "is-locked"));
      item.appendChild(label);
      els.chapters.appendChild(item);
    });

    updateSelected();
  }

  function renderResult() {
    var data = state.resolved;
    if (!data || !els.result) return;
    if (els.series) els.series.textContent = data.seriesTitle || data.episodeTitle || "未命名作品";
    if (els.episode) {
      els.episode.textContent = "当前章节：" + (data.episodeTitle || data.episodeId || "未知");
    }
    els.result.hidden = false;
    renderChapters();
  }

  /* ---------------- 预设 ---------------- */

  function applyPreset(preset) {
    var data = state.resolved;
    if (!data || busy()) return;
    var chapters = data.chapters || [];
    state.selected = Object.create(null);

    if (preset === "all") {
      chapters.forEach(function (chapter) {
        if (chapter.free) state.selected[chapter.id] = true;
      });
    } else if (preset === "current") {
      chapters.forEach(function (chapter) {
        if (chapter.free && chapter.current) state.selected[chapter.id] = true;
      });
    } else if (preset === "around") {
      var index = -1;
      for (var chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        if (chapters[chapterIndex].current) {
          index = chapterIndex;
          break;
        }
      }
      var from = Math.max(0, index - 5);
      var to = index === -1 ? 0 : index + 6;
      chapters.slice(from, to).forEach(function (chapter) {
        if (chapter.free) state.selected[chapter.id] = true;
      });
    }

    renderChapters();
  }

  /* ---------------- 解析 ---------------- */

  function resolve() {
    var value = els.url ? els.url.value.trim() : "";
    if (!value || busy() || !state.platform) return;

    state.phase = "resolving";
    state.resolved = null;
    syncUi();
    hideError();
    hideResult();
    hideDone();
    if (els.progress) els.progress.hidden = true;

    apiRequest("/tools/comics/" + encodeURIComponent(state.platform) + "/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: value }),
    })
      .then(function (data) {
        state.resolved = data;
        state.selected = Object.create(null);
        (data.chapters || []).forEach(function (chapter) {
          if (chapter.free && chapter.current) {
            state.selected[chapter.id] = true;
          }
        });
        state.phase = "idle";
        renderResult();
        syncUi();
      })
      .catch(function (error) {
        state.phase = "idle";
        syncUi();
        var message = friendlyError(error && error.message ? error.message : error);
        if (String(error && error.message) === "upstream_unavailable") {
          message += " " + UPSTREAM_HINT;
        }
        showError(message);
      });
  }

  /* ---------------- 下载打包 ---------------- */

  function mapWithConcurrency(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;

    function run() {
      if (cursor >= items.length) return Promise.resolve();
      var index = cursor;
      cursor += 1;
      return Promise.resolve(worker(items[index], index)).then(function (value) {
        results[index] = value;
        return run();
      });
    }

    var runners = [];
    var count = Math.min(limit, items.length);
    for (var index = 0; index < count; index += 1) {
      runners.push(run());
    }
    return Promise.all(runners).then(function () {
      return results;
    });
  }

  function imageProxyUrl(pageUrl, episodeUrl, name) {
    return (
      API +
      "/tools/comics/" +
      encodeURIComponent(state.platform) +
      "/image?url=" +
      encodeURIComponent(pageUrl) +
      "&referer=" +
      encodeURIComponent(episodeUrl) +
      "&name=" +
      encodeURIComponent(name)
    );
  }

  async function downloadChapter(chapter, index, total) {
    var episodeUrl = EPISODE_BASE + chapter.id;
    setProgress(index + 1, total, chapter.title || chapter.id, 0, 0, "获取页面中…");

    var pagesData = await apiRequest(
      "/tools/comics/" + encodeURIComponent(state.platform) + "/pages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeUrl: episodeUrl }),
      }
    );

    var pages = ((pagesData && pagesData.pages) || []).slice(0, MAX_PAGES_PER_REQUEST);
    if (!pages.length) {
      return { entries: [], failed: 1 };
    }

    var seriesFolder = ZIP.sanitizeFileName(state.resolved.seriesTitle || "comic");
    var chapterFolder = seriesFolder + "/" + ZIP.sanitizeFileName(chapter.title || chapter.id, chapter.id);
    var padding = String(pages.length).length;
    var done = 0;

    var loaded = await mapWithConcurrency(pages, IMAGE_CONCURRENCY, async function (page) {
      if (state.cancelled) return null;
      try {
        var response = await fetch(imageProxyUrl(page.url, episodeUrl, "p" + page.sort + ".jpg"));
        if (!response.ok) return null;
        var scrambled = await response.blob();
        var restored = await UNSCRAMBLE.unscramblePage(scrambled, page.scramble || null);
        var data = new Uint8Array(await restored.blob.arrayBuffer());
        done += 1;
        setProgress(index + 1, total, chapter.title || chapter.id, done, pages.length);
        return {
          name: chapterFolder + "/image_" + pad(page.sort + 1, padding) + "." + restored.extension,
          data: data,
        };
      } catch (error) {
        return null;
      }
    });

    var entries = loaded.filter(function (entry) {
      return entry !== null;
    });
    return { entries: entries, failed: loaded.length - entries.length };
  }

  async function runDownload(chapters, combine) {
    var seriesFolder = ZIP.sanitizeFileName(state.resolved.seriesTitle || "comic");
    var combinedEntries = [];
    var perChapter = [];
    var failedPages = 0;

    for (var index = 0; index < chapters.length; index += 1) {
      if (state.cancelled) break;
      var chapter = chapters[index];
      try {
        var result = await downloadChapter(chapter, index, chapters.length);
        failedPages += result.failed;
        if (combine) {
          combinedEntries.push.apply(combinedEntries, result.entries);
        } else if (result.entries.length) {
          perChapter.push({
            name: seriesFolder + "/" + ZIP.sanitizeFileName(chapter.title || chapter.id, chapter.id),
            entries: result.entries,
          });
        }
      } catch (error) {
        failedPages += 1;
      }
    }

    if (state.cancelled) {
      state.cancelled = false;
      state.phase = "idle";
      if (els.progress) els.progress.hidden = true;
      syncUi();
      return;
    }

    if (combine) {
      if (!combinedEntries.length) {
        throw new Error("没有下载到任何页面。");
      }
      ZIP.downloadBlob(ZIP.buildZip(combinedEntries), seriesFolder + ".zip");
    } else {
      if (!perChapter.length) {
        throw new Error("没有下载到任何页面。");
      }
      for (var itemIndex = 0; itemIndex < perChapter.length; itemIndex += 1) {
        var item = perChapter[itemIndex];
        ZIP.downloadBlob(ZIP.buildZip(item.entries), ZIP.sanitizeFileName(item.name) + ".zip");
        await sleep(300);
      }
    }

    state.phase = "idle";
    if (els.progress) els.progress.hidden = true;
    syncUi();
    showDone("已打包 " + chapters.length + " 话，跳过 " + failedPages + " 页。");
  }

  function startDownload() {
    var chapters = selectedFreeChapters();
    if (!chapters.length || busy()) return;
    var combine = els.combine ? els.combine.checked : true;

    state.phase = "downloading";
    state.cancelled = false;
    hideError();
    hideDone();
    syncUi();

    runDownload(chapters, combine).catch(function (error) {
      state.phase = "idle";
      if (els.progress) els.progress.hidden = true;
      syncUi();
      showError(String(error && error.message ? error.message : error));
    });
  }

  /* ---------------- 初始化 ---------------- */

  function loadPlatforms() {
    apiRequest("/tools/comics/platforms")
      .then(function (data) {
        var platforms = (data && data.platforms) || [];
        state.platforms = platforms;
        if (els.platform) els.platform.textContent = "";

        var firstEnabled = "";
        platforms.forEach(function (item) {
          var option = document.createElement("option");
          option.value = item.id;
          option.textContent = item.enabled ? item.name : item.name + " · 即将支持";
          option.disabled = !item.enabled;
          if (item.enabled && !firstEnabled) firstEnabled = item.id;
          if (els.platform) els.platform.appendChild(option);
        });

        state.platform = firstEnabled;
        if (els.platform) els.platform.value = firstEnabled;
        if (!firstEnabled) {
          showError("当前没有可用的漫画平台。");
        }
        syncUi();
      })
      .catch(function (error) {
        state.platform = "";
        syncUi();
        showError("平台列表读取失败：" + String(error && error.message ? error.message : error));
      });
  }

  if (els.resolve) els.resolve.addEventListener("click", resolve);
  if (els.url) {
    els.url.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        resolve();
      }
    });
  }
  if (els.platform) {
    els.platform.addEventListener("change", function () {
      state.platform = els.platform.value;
      state.resolved = null;
      hideResult();
      hideError();
      hideDone();
      syncUi();
    });
  }
  els.presets.forEach(function (button) {
    button.addEventListener("click", function () {
      applyPreset(button.getAttribute("data-preset"));
    });
  });
  if (els.download) els.download.addEventListener("click", startDownload);
  if (els.cancel) {
    els.cancel.addEventListener("click", function () {
      state.cancelled = true;
      if (els.cancel) els.cancel.disabled = true;
    });
  }

  hideResult();
  hideError();
  hideDone();
  if (els.progress) els.progress.hidden = true;
  syncUi();
  loadPlatforms();
})();
