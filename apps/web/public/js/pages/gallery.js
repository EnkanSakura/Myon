(function () {
  var grid = document.getElementById('galGrid');
  if (!grid) return;

  var shownNo = document.getElementById('shownNo');
  var shownTotal = document.getElementById('shownTotal');
  var clearFilter = document.getElementById('clearFilter');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.filterbar-tab'));
  var items = Array.prototype.slice.call(document.querySelectorAll('.ex'));
  // 分母是全柜展示中的件数（来自 /api/v1/stats），翻页不会把它改小。
  var displayedTotal =
    parseInt(grid.getAttribute('data-displayed') || '0', 10) || items.length;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function apply(cat) {
    var n = 0;
    items.forEach(function (it) {
      var on = cat === '全部' || it.getAttribute('data-cat') === cat;
      it.hidden = !on;
      if (on) {
        n++;
        it.classList.remove('is-in');
        void it.offsetWidth;
        it.classList.add('is-in');
      }
    });
    grid.classList.toggle('is-filtered', cat !== '全部');
    shownNo.textContent = pad(n);
    shownTotal.textContent = pad(displayedTotal);
    if (clearFilter) clearFilter.hidden = cat === '全部';
  }

  function activate(t) {
    tabs.forEach(function (x) {
      var on = x === t;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    apply(t.getAttribute('data-cat'));
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { activate(t); });
  });

  if (clearFilter) {
    clearFilter.addEventListener('click', function () {
      activate(tabs[0]);
      if (tabs[0]) tabs[0].focus();
    });
  }
})();

(function () {
  var dlg = document.getElementById('lb');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var img = document.getElementById('lbImg');
  var nofig = document.getElementById('lbNofig');
  var no = document.getElementById('lbNo');
  var cat = document.getElementById('lbCat');
  var title = document.getElementById('lbTitle');
  var meta = document.getElementById('lbMeta');
  var note = document.getElementById('lbNote');
  var plate = document.getElementById('lbPlate');
  var idxEl = document.getElementById('lbIdx');
  var totEl = document.getElementById('lbTot');
  var prevBtn = document.getElementById('lbPrev');
  var nextBtn = document.getElementById('lbNext');
  var closeBtn = dlg.querySelector('.lb-close');
  var all = Array.prototype.slice.call(document.querySelectorAll('.ex'));
  var list = [];
  var cur = 0;
  var last = null;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function paint() {
    var fig = list[cur];
    if (!fig) return;
    var pic = fig.querySelector('img');
    if (pic) {
      img.hidden = false;
      img.src = pic.getAttribute('src') || '';
      img.alt = pic.getAttribute('alt') || '';
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      img.alt = '';
    }
    if (nofig) nofig.hidden = !!pic;
    no.textContent = fig.getAttribute('data-no') || '';
    cat.textContent = fig.getAttribute('data-cat') || '';
    title.textContent = fig.getAttribute('data-name') || '';
    meta.textContent = fig.getAttribute('data-meta') || '';
    note.textContent = fig.getAttribute('data-note') || '';
    plate.textContent = 'PLATE ' + pad(cur + 1) + ' / ' + pad(list.length);
    idxEl.textContent = pad(cur + 1);
    totEl.textContent = pad(list.length);
    prevBtn.disabled = list.length < 2;
    nextBtn.disabled = list.length < 2;
  }

  function go(d) {
    if (list.length < 2) return;
    cur = (cur + d + list.length) % list.length;
    paint();
  }

  function openLb(btn) {
    list = all.filter(function (it) { return !it.hidden; });
    cur = list.indexOf(btn.closest('.ex'));
    if (cur < 0) cur = 0;
    last = btn;
    paint();
    document.documentElement.classList.add('lb-lock');
    dlg.showModal();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.ex-open'), function (btn) {
    btn.addEventListener('click', function () { openLb(btn); });
  });

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });
  closeBtn.addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  dlg.addEventListener('close', function () {
    document.documentElement.classList.remove('lb-lock');
    if (last) last.focus();
  });
})();
