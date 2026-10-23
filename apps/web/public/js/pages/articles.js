(function () {
  var count = document.getElementById('shownCount');
  var empty = document.getElementById('empty');
  var emptyTag = document.getElementById('emptyTag');
  var clear = document.getElementById('clearFilter');
  var clearEmpty = document.getElementById('clearEmpty');
  var tabs = Array.prototype.slice.call(
    document.querySelectorAll('.filterbar-tabs .filterbar-tab'),
  );
  var rows = Array.prototype.slice.call(document.querySelectorAll('#list .r'));
  var years = Array.prototype.slice.call(document.querySelectorAll('.year'));

  // 默认选中最近的一年（与设计稿一致）；点“清除筛选”回到全部年份。
  var activeTag = '全部';
  var activeYear = years.length ? years[0].getAttribute('data-year') : 'all';

  function filtered() {
    return activeTag !== '全部' || activeYear !== 'all';
  }

  function label() {
    var parts = [];
    if (activeTag !== '全部') parts.push(activeTag);
    if (activeYear !== 'all') parts.push(activeYear + ' 年');
    return parts.length ? parts.join(' · ') : '全部';
  }

  function paintClear() {
    if (clear) clear.hidden = !filtered();
  }

  function apply() {
    // 服务端已渲染空页（?page 翻过头）：保留服务端的空白页说明，不回填筛选空态。
    if (!rows.length) {
      if (count) count.textContent = '0';
      paintClear();
      return;
    }

    var n = 0;
    rows.forEach(function (r) {
      var tagOk = activeTag === '全部' || r.getAttribute('data-tag') === activeTag;
      var yearOk = activeYear === 'all' || r.getAttribute('data-year') === activeYear;
      var on = tagOk && yearOk;
      r.hidden = !on;
      if (on) n++;
    });

    if (count) count.textContent = n;
    if (empty && emptyTag) {
      if (n === 0) {
        emptyTag.textContent = label();
        empty.classList.add('is-on');
      } else {
        empty.classList.remove('is-on');
      }
    }
    paintClear();
  }

  function paintTabs() {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tag') === activeTag;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function paintYears() {
    years.forEach(function (y) {
      var on = y.getAttribute('data-year') === activeYear;
      y.classList.toggle('is-on', on);
      y.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function reset() {
    activeTag = '全部';
    activeYear = 'all';
    paintTabs();
    paintYears();
    apply();
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      activeTag = t.getAttribute('data-tag') || '全部';
      paintTabs();
      apply();
    });
  });

  years.forEach(function (y) {
    y.addEventListener('click', function () {
      var year = y.getAttribute('data-year');
      // 再点一次当前年份就取消年份筛选
      activeYear = activeYear === year ? 'all' : year;
      paintYears();
      apply();
    });
  });

  if (clear) clear.addEventListener('click', reset);

  if (clearEmpty) {
    clearEmpty.addEventListener('click', function () {
      reset();
      tabs[0]?.focus({ preventScroll: true });
    });
  }

  apply();
})();
