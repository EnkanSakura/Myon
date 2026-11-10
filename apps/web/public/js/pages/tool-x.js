(function () {
  'use strict';

  /* 工具 · X（Twitter）媒体下载
     - 页面由 /tools/<slug> 的 #xTool 工作台渲染，data-api 给出 API 前缀；
     - 解析走 GET {api}/tools/x/media?url=，媒体文件经 {api}/tools/x/proxy 中转；
     - 推文内容都是外部数据，只用 DOM API（textContent / setAttribute）写入，
       不拼 innerHTML，避免把上游返回值当成 HTML 执行。 */

  var root = document.getElementById('xTool');
  if (!root) return;

  var API = (root.getAttribute('data-api') || '/api/v1').replace(/\/+$/, '');
  var KIND_LABELS = { video: '视频', gif: 'GIF', photo: '图片' };
  var ERROR_INVALID_URL = '链接格式不正确，请粘贴完整的推文链接';
  var ERROR_UNAVAILABLE = '无法获取这条推文，可能已被删除或受到保护';
  var ERROR_DEFAULT = '解析失败，请检查链接或稍后重试';

  function byId(id) {
    return document.getElementById(id);
  }

  var els = {
    url: byId('xUrl'),
    resolve: byId('xResolve'),
    error: byId('xError'),
    errorText: byId('xErrorText'),
    result: byId('xResult'),
    avatar: byId('xAvatar'),
    name: byId('xName'),
    handle: byId('xHandle'),
    date: byId('xDate'),
    text: byId('xText'),
    link: byId('xLink'),
    source: byId('xSource'),
    media: byId('xMedia'),
    empty: byId('xEmpty'),
  };

  // 其他页面没有这套节点时直接收工，不报错。
  if (!els.url || !els.resolve) return;

  var loading = false;
  var copyTimer = null;

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /* ---------- 地址与文件名 ---------- */

  /** 媒体中转地址：后端只放行 twimg.com，浏览器下载时文件名由 name 决定。 */
  function proxyUrl(url, name) {
    return (
      API +
      '/tools/x/proxy?url=' +
      encodeURIComponent(url) +
      '&name=' +
      encodeURIComponent(name)
    );
  }

  /** 图片扩展名取 URL 后缀，取不到按 jpg；视频 / GIF 一律 mp4。 */
  function photoExtension(url) {
    var match = String(url || '')
      .split('?')[0]
      .match(/\.(\w+)$/);
    return match ? match[1] : 'jpg';
  }

  /** 下载文件名：tweetId_序号[ _清晰度序号].mp4/jpg。 */
  function fileNameFor(tweetId, item, index, variantIndex) {
    var variants = item.variants || [];
    var url =
      variantIndex === undefined
        ? item.url
        : (variants[variantIndex] && variants[variantIndex].url) || item.url;
    var extension = item.kind === 'photo' ? photoExtension(url) : 'mp4';
    var suffix = variantIndex === undefined ? '' : '_' + (variantIndex + 1);
    return tweetId + '_' + (index + 1) + suffix + '.' + extension;
  }

  /* ---------- 错误与加载状态 ---------- */

  /** 后端错误码 → 中文文案；未知错误统一给兜底提示。 */
  function friendlyError(message) {
    var text = String(message || '');
    if (text.indexOf('invalid_tweet_url') >= 0) return ERROR_INVALID_URL;
    if (text.indexOf('tweet_resolve_failed') >= 0) return ERROR_UNAVAILABLE;
    return ERROR_DEFAULT;
  }

  function errorTextOf(body) {
    if (!body) return '';
    if (typeof body.error === 'string') return body.error;
    if (body.error && typeof body.error.value === 'string') {
      return body.error.value;
    }
    if (typeof body.message === 'string') return body.message;
    return '';
  }

  function showError(message) {
    if (!els.error || !els.errorText) return;
    els.errorText.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    if (els.error) els.error.hidden = true;
  }

  function setLoading(on) {
    loading = on;
    els.resolve.disabled = on;
    els.resolve.textContent = on ? '解析中…' : '解析';
  }

  /* ---------- 媒体卡片 ---------- */

  function copyLink(button) {
    var url = button.getAttribute('data-copy') || '';
    function done() {
      button.textContent = '已复制';
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        button.textContent = '复制链接';
      }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    } else {
      done();
    }
  }

  function variantLabel(variant) {
    if (variant.bitrate) return Math.round(variant.bitrate / 1000) + ' kbps';
    return variant.container || '视频';
  }

  function buildVariants(tweetId, item, index) {
    var details = el('details', 'x-variants');
    var summary = el('summary');
    summary.textContent = '其他清晰度';
    details.appendChild(summary);

    var list = document.createElement('ul');
    item.variants.forEach(function (variant, variantIndex) {
      var row = document.createElement('li');
      var label = el('span', 'x-variant-label');
      label.textContent = variantLabel(variant);
      row.appendChild(label);

      var link = el('a', 'x-variant-link');
      link.href = proxyUrl(
        variant.url,
        fileNameFor(tweetId, item, index, variantIndex),
      );
      link.setAttribute('download', '');
      link.textContent = '下载';
      row.appendChild(link);
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  function buildCard(tweetId, item, index) {
    var card = el('div', 'x-card');

    // 预览图：图片用原图，视频 / GIF 用封面；没有封面就不渲染 img。
    var thumb = el('div', 'x-thumb');
    var previewUrl = item.kind === 'photo' ? item.url : item.thumbnailUrl;
    if (previewUrl) {
      var img = document.createElement('img');
      img.src = proxyUrl(previewUrl, 'preview-' + index);
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    }
    var kind = el('span', 'x-kind');
    kind.textContent = KIND_LABELS[item.kind] || item.kind || '媒体';
    thumb.appendChild(kind);
    card.appendChild(thumb);

    var meta = el('div', 'x-card-meta');
    var size = el('span', 'x-size');
    size.textContent = item.label || '未知尺寸';
    meta.appendChild(size);
    var variants = item.variants || [];
    if (variants.length > 1) {
      var count = el('span', 'x-count');
      count.textContent = variants.length + ' 个清晰度';
      meta.appendChild(count);
    }
    card.appendChild(meta);

    var actions = el('div', 'x-actions');
    // 1) 直链下载：直接打开 CDN 地址，不经过站内中转。
    var direct = el('a', 'x-btn');
    direct.href = item.url;
    direct.target = '_blank';
    direct.rel = 'noreferrer noopener';
    direct.textContent = '直链下载';
    actions.appendChild(direct);

    // 2) 服务器中转：经过 /tools/x/proxy，并带上文件名。
    var proxy = el('a', 'x-btn');
    proxy.href = proxyUrl(item.url, fileNameFor(tweetId, item, index));
    proxy.setAttribute('download', '');
    proxy.textContent = '服务器中转';
    actions.appendChild(proxy);

    // 3) 复制链接：复制原始 CDN 地址，成功后短暂显示「已复制」。
    var copy = el('button', 'x-btn');
    copy.type = 'button';
    copy.setAttribute('data-copy', item.url);
    copy.textContent = '复制链接';
    copy.addEventListener('click', function () {
      copyLink(copy);
    });
    actions.appendChild(copy);
    card.appendChild(actions);

    if (variants.length > 1) {
      card.appendChild(buildVariants(tweetId, item, index));
    }
    return card;
  }

  /* ---------- 结果渲染 ---------- */

  function renderResult(data) {
    var tweetId = data.tweetId || 'x';

    if (data.authorAvatar) {
      els.avatar.src = proxyUrl(data.authorAvatar, 'avatar.jpg');
      els.avatar.hidden = false;
    } else {
      els.avatar.hidden = true;
      els.avatar.removeAttribute('src');
    }

    els.name.textContent = data.authorName || '';
    els.handle.textContent = data.authorHandle ? '@' + data.authorHandle : '';

    // 发布时间可能为空：空就不占位。
    if (data.createdAt) {
      els.date.textContent = data.createdAt;
      els.date.hidden = false;
    } else {
      els.date.textContent = '';
      els.date.hidden = true;
    }

    els.text.textContent = data.text || '';

    if (data.url) {
      els.link.href = data.url;
      els.link.textContent = '打开原推文';
      els.link.hidden = false;
    } else {
      els.link.hidden = true;
    }
    if (data.source) {
      els.source.textContent = '数据来源：' + data.source;
      els.source.hidden = false;
    } else {
      els.source.textContent = '';
      els.source.hidden = true;
    }

    // 媒体列表全部用 DOM 创建，先清掉上一次的结果。
    while (els.media.firstChild) els.media.removeChild(els.media.firstChild);
    var media = Array.isArray(data.media) ? data.media : [];
    if (media.length === 0) {
      els.empty.hidden = false;
    } else {
      els.empty.hidden = true;
      media.forEach(function (item, index) {
        els.media.appendChild(buildCard(tweetId, item, index));
      });
    }

    els.result.hidden = false;
  }

  /* ---------- 解析 ---------- */

  function resolve() {
    if (loading) return;
    var value = (els.url.value || '').trim();
    if (!value) {
      els.url.focus();
      return;
    }

    hideError();
    els.result.hidden = true;
    setLoading(true);

    fetch(API + '/tools/x/media?url=' + encodeURIComponent(value), {
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            return { ok: response.ok, body: body };
          });
      })
      .then(function (payload) {
        setLoading(false);
        var body = payload.body;
        if (!payload.ok || (body && body.error)) {
          showError(friendlyError(errorTextOf(body)));
          return;
        }
        // 兼容接口直接返回数据或包一层 data 的写法。
        renderResult(body && body.data ? body.data : body);
      })
      .catch(function () {
        setLoading(false);
        showError(ERROR_DEFAULT);
      });
  }

  els.resolve.addEventListener('click', resolve);
  els.url.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      resolve();
    }
  });
})();
