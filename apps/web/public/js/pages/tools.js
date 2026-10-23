(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* ---------- 索引搜索：只在工具列表上过滤 ---------- */
  var search = byId('toolSearch');

  if (!search) return;

  var tools = Array.prototype.slice.call(document.querySelectorAll('.tool'));
  var countEl = byId('indexCount');
  var emptyBox = byId('searchEmpty');
  var emptyQ = byId('emptyQ');
  var clearBtn = byId('clearSearch');

  function filterTools() {
    var raw = search.value.trim();
    var q = raw.toLowerCase();
    var n = 0;
    tools.forEach(function (t) {
      var desc = t.querySelector('.tdesc');
      var hay = (
        (t.getAttribute('data-name') || '') + ' ' +
        (desc ? desc.textContent || '' : '') + ' ' +
        (t.getAttribute('data-kw') || '')
      ).toLowerCase();
      var on = !q || hay.indexOf(q) > -1;
      t.hidden = !on;
      if (on) n++;
    });
    if (countEl) countEl.textContent = pad2(n);
    var none = q !== '' && n === 0;
    if (emptyBox) emptyBox.hidden = !none;
    if (none && emptyQ) emptyQ.textContent = raw;
  }

  search.addEventListener('input', filterTools);
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      search.value = '';
      filterTools();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      search.value = '';
      filterTools();
      search.focus();
    });
  }
})();
