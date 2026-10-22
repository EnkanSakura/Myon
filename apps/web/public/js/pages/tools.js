(function () {
  var input = document.getElementById('tsInput');
  var resTime = document.getElementById('resTime');
  var resZone = document.getElementById('resZone');
  var resWeek = document.getElementById('resWeek');
  var resEpoch = document.getElementById('resEpoch');
  var copyNote = document.getElementById('copyNote');
  var copyBtn = document.getElementById('copyBtn');
  var shuffleBtn = document.getElementById('shuffleBtn');
  var unitBtns = Array.prototype.slice.call(document.querySelectorAll('.seg-btn'));
  var tzSel = document.getElementById('tzSel');
  var state = { unit: 's', tz: 8 };
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var samples = [1790856000, 1793520000, 1789000000, 1795000000];
  var sampleAt = 0;
  var noteTimer = null;
  var lastValid = null;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function tzLabel() {
    var t = state.tz;
    return '本地时间 UTC' + (t >= 0 ? '+' : '−') + Math.abs(t);
  }

  function readSeconds() {
    var raw = input.value.replace(/[\s,_]/g, '');
    if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
    var v = parseFloat(raw);
    if (!isFinite(v)) return null;
    var sec = state.unit === 'ms' ? v / 1000 : v;
    if (Math.abs(sec) > 8.64e12) return null;
    return sec;
  }

  function render() {
    var sec = readSeconds();
    resZone.textContent = tzLabel();
    if (sec === null) {
      lastValid = null;
      resTime.textContent = '——';
      resTime.classList.add('is-empty');
      resWeek.textContent = '等待输入';
      resEpoch.textContent = '输入秒或毫秒的数字';
      return;
    }
    var shifted = new Date(Math.round(sec * 1000) + state.tz * 3600 * 1000);
    var text = shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1) + '-' + pad(shifted.getUTCDate())
      + ' ' + pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes()) + ':' + pad(shifted.getUTCSeconds());
    lastValid = text;
    resTime.textContent = text;
    resTime.classList.remove('is-empty');
    resWeek.textContent = WEEK[shifted.getUTCDay()];
    resEpoch.textContent = 'Unix ' + input.value.trim();
  }

  function showNote(text) {
    copyNote.textContent = text;
    copyNote.classList.add('is-on');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(function () { copyNote.classList.remove('is-on'); }, 4000);
  }

  input.addEventListener('input', render);
  tzSel.addEventListener('change', function () {
    state.tz = parseFloat(tzSel.value);
    render();
  });
  unitBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      state.unit = b.getAttribute('data-unit');
      unitBtns.forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });
  shuffleBtn.addEventListener('click', function () {
    sampleAt = (sampleAt + 1) % samples.length;
    var sec = samples[sampleAt];
    input.value = state.unit === 'ms' ? String(sec * 1000) : String(sec);
    render();
    input.focus();
    input.select();
  });
  copyBtn.addEventListener('click', function () {
    if (!lastValid) {
      showNote('先输入一个有效的时间戳');
      return;
    }
    var text = lastValid;
    function done() { showNote('已复制：' + text); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  });
  render();

  /* ---------- 搜索过滤 ---------- */
  var search = document.getElementById('toolSearch');
  var tools = Array.prototype.slice.call(document.querySelectorAll('.tool'));
  var countEl = document.getElementById('indexCount');
  var emptyBox = document.getElementById('searchEmpty');
  var emptyQ = document.getElementById('emptyQ');
  var clearBtn = document.getElementById('clearSearch');

  function filterTools() {
    var q = search.value.trim().toLowerCase();
    var n = 0;
    tools.forEach(function (t) {
      var hay = (t.getAttribute('data-name') + ' ' + t.querySelector('.tdesc').textContent + ' ' + t.getAttribute('data-kw')).toLowerCase();
      var on = !q || hay.indexOf(q) > -1;
      t.hidden = !on;
      if (on) n++;
    });
    countEl.textContent = ('0' + n).slice(-2);
    var none = q !== '' && n === 0;
    emptyBox.hidden = !none;
    if (none) emptyQ.textContent = search.value.trim();
  }

  search.addEventListener('input', filterTools);
  clearBtn.addEventListener('click', function () {
    search.value = '';
    filterTools();
    search.focus();
  });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      search.value = '';
      filterTools();
    }
  });

  /* ---------- 切换当前工具 ---------- */
  var benchTab = document.getElementById('benchTab');
  var benchKind = document.getElementById('benchKind');
  var benchTitle = document.getElementById('benchTitle');
  var benchDesc = document.getElementById('benchDesc');
  var tsPanel = document.getElementById('panel-ts');
  var altPanels = Array.prototype.slice.call(document.querySelectorAll('.altpanel[data-panel]'));

  function setTool(btn) {
    if (btn.getAttribute('aria-current') === 'true') return;
    tools.forEach(function (x) {
      if (x === btn) x.setAttribute('aria-current', 'true');
      else x.removeAttribute('aria-current');
    });
    var id = btn.getAttribute('data-tool');
    benchTab.textContent = 'TOOL ' + btn.getAttribute('data-no');
    benchKind.textContent = btn.getAttribute('data-kind');
    benchTitle.textContent = btn.getAttribute('data-name');
    benchDesc.textContent = btn.getAttribute('data-desc');
    var isTs = id === 'ts';
    tsPanel.hidden = !isTs;
    altPanels.forEach(function (p) {
      p.hidden = p.getAttribute('data-panel') !== id;
    });
  }

  tools.forEach(function (t) {
    t.addEventListener('click', function () { setTool(t); });
  });
})();
