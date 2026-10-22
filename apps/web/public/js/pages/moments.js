(function () {
  'use strict';

  var stream = document.getElementById('stream');
  var moments = [].slice.call(stream.querySelectorAll('.moment'));
  var tabs = [].slice.call(document.querySelectorAll('.tabs .tag'));
  var chips = [].slice.call(document.querySelectorAll('.moment .mf .tag'));
  var shownEl = document.getElementById('shown');
  var emptyBox = document.getElementById('empty');
  var emptyCond = document.getElementById('emptyCond');
  var onlyImg = document.getElementById('only-img');
  var clearBtn = document.getElementById('clear-filter');
  var subForm = document.querySelector('.sub-box');
  var subNote = document.getElementById('sub-note');
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
      onlyImg.checked = false;
      state.tag = 'all';
      paint();
      apply();
      var allTab = document.querySelector('.tabs .tag[data-tag="all"]');
      if (allTab) allTab.focus({ preventScroll: true });
    });
  }

  if (subForm) {
    var subInput = subForm.querySelector('input');
    var submitSubscribe = function () {
      if (!subInput.value || !subInput.checkValidity()) {
        subNote.textContent = '写一个能收信的邮箱就行。';
        subNote.classList.add('is-warn');
        subInput.focus();
        return;
      }
      subNote.classList.remove('is-warn');
      subNote.textContent = '记下了 · 下一封在周日晚上。';
      subInput.value = '';
    };
    subForm.addEventListener('submit', function (e) {
      e.preventDefault();
      submitSubscribe();
    });
    subInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitSubscribe();
      }
    });
  }

  // 服务端已按真实数据渲染；这里再跑一次，校正计数、空态与无数据时的布局。
  commit();
})();
