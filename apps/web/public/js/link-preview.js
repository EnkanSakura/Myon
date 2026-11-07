/* Myon · 外部网站卡片补全
   服务端/Markdown 预览先输出基础卡（域名 + URL），这里再调
   `/api/v1/link-preview` 补标题、描述、站点名与 favicon；失败保持基础卡。
   MutationObserver 让后台预览重渲染后也能自动补齐。 */
(function () {
  'use strict';

  var cache = {};
  var observed = false;
  var timer = null;

  function endpoint() {
    var body = document.body;
    var injected = body ? body.getAttribute('data-link-preview-api') : '';
    return injected || '/api/v1/link-preview';
  }

  function setText(card, selector, value) {
    if (!value) return;
    var node = card.querySelector(selector);
    if (node) node.textContent = value;
  }

  function paint(card, item) {
    if (!item) return;
    if (item.siteName) setText(card, '[data-link-site]', item.siteName);
    if (item.title) setText(card, '[data-link-title]', item.title);
    if (item.host) setText(card, '[data-link-domain]', item.host);
    if (item.url) card.setAttribute('href', item.url);

    var desc = card.querySelector('[data-link-desc]');
    if (desc && item.description) {
      desc.textContent = item.description;
      desc.hidden = false;
    }

    var icon = card.querySelector('[data-link-icon]');
    var globe = card.querySelector('[data-link-globe]');
    if (icon && item.icon) {
      icon.onload = function () {
        icon.hidden = false;
        if (globe) globe.hidden = true;
      };
      icon.onerror = function () {
        icon.hidden = true;
        if (globe) globe.hidden = false;
      };
      icon.src = item.icon;
      icon.alt = '';
    }
    card.setAttribute('data-link-loaded', 'true');
  }

  function load(url) {
    if (cache[url]) return cache[url];
    cache[url] = fetch(endpoint() + '?url=' + encodeURIComponent(url), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        return body && body.ok ? body.item : null;
      })
      .catch(function () {
        return null;
      });
    return cache[url];
  }

  function fillCard(card) {
    if (!card) return;
    if (
      card.getAttribute('data-link-pending') ||
      card.getAttribute('data-link-loaded')
    ) {
      return;
    }
    var url = card.getAttribute('data-link-preview');
    if (!url) return;
    card.setAttribute('data-link-pending', 'true');
    load(url).then(function (item) {
      card.removeAttribute('data-link-pending');
      if (item) paint(card, item);
    });
  }

  function fill(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var cards = scope.querySelectorAll('.site-card[data-link-preview]');
    Array.prototype.forEach.call(cards, fillCard);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      fill(document);
    }, 120);
  }

  function init() {
    fill(document);
    if (!observed && window.MutationObserver) {
      observed = true;
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MyonLinkPreview = { fill: fill };
})();
