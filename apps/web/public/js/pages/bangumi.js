(function () {
  var bar = document.getElementById('syncbar');
  var btn = document.getElementById('syncBtn');
  var btnLabel = document.getElementById('syncBtnLabel');
  var state = document.getElementById('syncText');
  var meta = document.getElementById('syncMeta');
  if (!bar || !btn || !btnLabel || !state || !meta) return;

  var busy = false;
  // 目前没有真实的 Bangumi 同步任务：按钮保留设计稿的动效，只改文案并明确标注占位。
  var updated = bar.getAttribute('data-updated') || '';
  var syncedMeta = updated
    ? '最近更新 · ' + updated + ' · 同步任务未接入'
    : '暂无数据 · 同步任务未接入';

  btn.addEventListener('click', function () {
    if (busy) return;
    busy = true;
    bar.classList.add('is-syncing');
    bar.classList.remove('is-fresh');
    btn.setAttribute('aria-busy', 'true');
    state.textContent = '同步中…';
    btnLabel.textContent = '同步中…';

    window.setTimeout(function () {
      bar.classList.remove('is-syncing');
      bar.classList.add('is-fresh');
      btn.removeAttribute('aria-busy');
      state.textContent = '占位同步 · 未接入';
      meta.textContent = syncedMeta;
      btnLabel.textContent = '立即同步';
      busy = false;
      window.setTimeout(function () {
        bar.classList.remove('is-fresh');
      }, 1800);
    }, 1200);
  });
})();
