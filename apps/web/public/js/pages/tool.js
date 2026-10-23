(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  /* ---------- 时间戳换算：只有 /tools/timestamp 页才有这些元素 ---------- */
  var input = byId('tsInput');

  // 其他工具页没有换算表单，脚本直接收工，不报错。
  if (!input) return;

  var resTime = byId('resTime');
  var resZone = byId('resZone');
  var resWeek = byId('resWeek');
  var resEpoch = byId('resEpoch');
  var copyNote = byId('copyNote');
  var copyBtn = byId('copyBtn');
  var shuffleBtn = byId('shuffleBtn');
  var unitBtns = Array.prototype.slice.call(document.querySelectorAll('.seg-btn'));
  var tzSel = byId('tzSel');
  var state = { unit: 's', tz: 8 };
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var samples = [1790856000, 1793520000, 1789000000, 1795000000];
  var sampleAt = 0;
  var noteTimer = null;
  var lastValid = null;

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

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
    if (resZone) resZone.textContent = tzLabel();
    if (sec === null) {
      lastValid = null;
      if (resTime) {
        resTime.textContent = '——';
        resTime.classList.add('is-empty');
      }
      if (resWeek) resWeek.textContent = '等待输入';
      if (resEpoch) resEpoch.textContent = '输入秒或毫秒的数字';
      return;
    }
    var shifted = new Date(Math.round(sec * 1000) + state.tz * 3600 * 1000);
    var text =
      shifted.getUTCFullYear() +
      '-' +
      pad(shifted.getUTCMonth() + 1) +
      '-' +
      pad(shifted.getUTCDate()) +
      ' ' +
      pad(shifted.getUTCHours()) +
      ':' +
      pad(shifted.getUTCMinutes()) +
      ':' +
      pad(shifted.getUTCSeconds());
    lastValid = text;
    if (resTime) {
      resTime.textContent = text;
      resTime.classList.remove('is-empty');
    }
    if (resWeek) resWeek.textContent = WEEK[shifted.getUTCDay()];
    if (resEpoch) resEpoch.textContent = 'Unix ' + input.value.trim();
  }

  function showNote(text) {
    if (!copyNote) return;
    copyNote.textContent = text;
    copyNote.classList.add('is-on');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(function () {
      copyNote.classList.remove('is-on');
    }, 4000);
  }

  input.addEventListener('input', render);
  render();

  if (tzSel) {
    tzSel.addEventListener('change', function () {
      state.tz = parseFloat(tzSel.value);
      render();
    });
  }

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

  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', function () {
      sampleAt = (sampleAt + 1) % samples.length;
      var sec = samples[sampleAt];
      input.value = state.unit === 'ms' ? String(sec * 1000) : String(sec);
      render();
      input.focus();
      input.select();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!lastValid) {
        showNote('先输入一个有效的时间戳');
        return;
      }
      var text = lastValid;
      function done() {
        showNote('已复制：' + text);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  }
})();
