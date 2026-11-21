(function () {
  'use strict';

  var stream = document.getElementById('stream');
  var moments = [].slice.call(stream.querySelectorAll('.moment'));
  var tabs = [].slice.call(
    document.querySelectorAll('.filterbar-tabs .filterbar-tab'),
  );
  var chips = [].slice.call(document.querySelectorAll('.moment .mf .tag'));
  var shownEl = document.getElementById('shown');
  var emptyBox = document.getElementById('empty');
  var emptyCond = document.getElementById('emptyCond');
  var onlyImg = document.getElementById('only-img');
  var clearBtn = document.getElementById('clear-filter');
  var barClear = document.getElementById('clearFilterBar');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var state = { tag: 'all' };
  var timer = null;

  function matches(m) {
    if (state.tag !== 'all' && m.getAttribute('data-tag') !== state.tag) return false;
    if (onlyImg.checked && m.getAttribute('data-photo') !== '1') return false;
    return true;
  }

  function paint() {
    tabs.concat(chips).forEach(function (b) {
      var on = b.getAttribute('data-tag') === state.tag;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (barClear) barClear.hidden = state.tag === 'all' && !onlyImg.checked;
  }

  function commit() {
    timer = null;
    var count = 0;
    moments.forEach(function (m) {
      var ok = matches(m);
      if (!ok) {
        m.hidden = true;
        m.classList.remove('is-in');
        m.classList.add('is-out');
        return;
      }
      count += 1;
      var wasHidden = m.hidden;
      m.hidden = false;
      m.classList.remove('is-out');
      if (wasHidden && !reduce.matches) {
        m.classList.remove('is-in');
        void m.offsetWidth;
        m.classList.add('is-in');
      }
    });
    shownEl.textContent = String(count);
    emptyBox.hidden = count !== 0;
    stream.classList.toggle('is-void', count === 0);
    stream.classList.toggle('is-filtered', state.tag !== 'all' || onlyImg.checked);
    if (count === 0 && emptyCond) {
      emptyCond.textContent = (state.tag === 'all' ? '全部' : state.tag) + (onlyImg.checked ? ' · 只看带图' : '');
    }
    paint();
  }

  function apply() {
    if (timer) { clearTimeout(timer); timer = null; }
    var fading = false;
    moments.forEach(function (m) {
      if (!m.hidden && !matches(m)) { m.classList.add('is-out'); fading = true; }
    });
    if (!fading || reduce.matches) {
      commit();
    } else {
      timer = setTimeout(commit, 170);
    }
  }

  function scrollToStream() {
    var topbar = document.querySelector('.topbar');
    var top = stream.getBoundingClientRect().top + window.pageYOffset - topbar.offsetHeight - 16;
    window.scrollTo({ top: Math.max(top, 0), behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  function setTag(tag) {
    state.tag = tag;
    paint();
    apply();
  }

  function reset() {
    onlyImg.checked = false;
    state.tag = 'all';
    paint();
    apply();
  }

  tabs.forEach(function (b) {
    b.addEventListener('click', function () { setTag(b.getAttribute('data-tag')); });
  });

  chips.forEach(function (b) {
    b.addEventListener('click', function () {
      setTag(b.getAttribute('data-tag'));
      if (stream.getBoundingClientRect().top < -80) scrollToStream();
    });
  });

  onlyImg.addEventListener('change', function () { apply(); });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      reset();
      var allTab = document.querySelector('.filterbar-tabs .filterbar-tab[data-tag="all"]');
      if (allTab) allTab.focus({ preventScroll: true });
    });
  }

  if (barClear) {
    barClear.addEventListener('click', function () {
      reset();
      var allTab = document.querySelector('.filterbar-tabs .filterbar-tab[data-tag="all"]');
      if (allTab) allTab.focus({ preventScroll: true });
    });
  }

  /* ---------- 动态详情：点击卡片上的整块热区打开 ---------- */
  var view = document.getElementById('momentView');
  var mvNo = document.getElementById('mvNo');
  var mvTime = document.getElementById('mvTime');
  var mvCat = document.getElementById('mvCat');
  var mvBody = document.getElementById('mvBody');
  var mvFigs = document.getElementById('mvFigs');
  var mvKind = document.getElementById('mvKind');
  var mvClose = document.getElementById('mvClose');

  function openDetail(card) {
    if (!view || !card) return;
    var no = card.querySelector('.no');
    var tm = card.querySelector('.tm');
    var body = card.querySelector('.moment-body');
    var figs = [].slice.call(card.querySelectorAll('.frame img'));
    var category = card.getAttribute('data-tag') || '未分类';

    mvNo.textContent = no ? no.textContent : 'N° —';
    mvTime.textContent = tm ? tm.textContent : '';
    mvCat.textContent = category;
    mvBody.textContent = body ? body.textContent : '';
    mvKind.textContent = figs.length
      ? figs.length > 1
        ? 'FIGURE · ' + figs.length + ' 张'
        : 'FIGURE · 带图'
      : 'NOTE · 手记';

    mvFigs.innerHTML = '';
    figs.forEach(function (img, index) {
      var figure = document.createElement('figure');
      figure.className = 'mv-fig frame';
      var full = document.createElement('img');
      full.src = img.getAttribute('src') || '';
      full.alt = img.getAttribute('alt') || '动态配图';
      full.loading = 'lazy';
      full.decoding = 'async';
      figure.appendChild(full);
      var cap = document.createElement('figcaption');
      cap.className = 'cap';
      var left = document.createElement('span');
      left.textContent = 'FIGURE ' + String(index + 1).padStart(2, '0');
      var right = document.createElement('span');
      right.textContent = category;
      cap.appendChild(left);
      cap.appendChild(right);
      figure.appendChild(cap);
      mvFigs.appendChild(figure);
    });
    mvFigs.hidden = figs.length === 0;

    if (typeof view.showModal === 'function') {
      if (!view.open) view.showModal();
    } else {
      view.setAttribute('open', '');
    }
    if (mvClose) mvClose.focus({ preventScroll: true });
  }

  function closeDetail() {
    if (!view) return;
    if (typeof view.close === 'function') {
      if (view.open) view.close();
    } else {
      view.removeAttribute('open');
    }
  }

  if (view) {
    if (mvClose) mvClose.addEventListener('click', closeDetail);
    // closedby="any" 负责点击背景关闭；不支持该属性的浏览器用坐标兜底，
    // 不能用 event.target === dialog 判断，否则点弹窗自身留白也会误关。
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      var pressedOutside = false;
      function outside(event) {
        var rect = view.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      }
      view.addEventListener('pointerdown', function (event) {
        pressedOutside = outside(event);
      });
      view.addEventListener('pointerup', function (event) {
        if (pressedOutside && outside(event)) closeDetail();
      });
    }
    stream.addEventListener('click', function (event) {
      var hit = event.target.closest('.moment-hit');
      if (!hit) return;
      openDetail(hit.closest('.moment'));
    });
  }

  // 服务端已按真实数据渲染；这里再跑一次，校正计数、空态与无数据时的布局。
  commit();
})();
