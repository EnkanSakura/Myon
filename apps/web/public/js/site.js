/* Myon · 全站公共交互：深浅色切换 + 封面「关于」入场动画 */
(function(){
  var root = document.documentElement;
  var KEY = 'myon-theme';

  function current(){ return root.dataset.theme === 'dark' ? 'dark' : 'light'; }
  function setTheme(t){
    root.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch(e){}
    document.querySelectorAll('.theme-btn').forEach(function(b){
      b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      b.setAttribute('aria-label', t === 'dark' ? '当前深色，切换到浅色' : '当前浅色，切换到深色');
      var lab = b.querySelector('.tb-label');
      if(lab) lab.textContent = t === 'dark' ? '浅色' : '深色';
      b.classList.toggle('is-dark', t === 'dark');
    });
  }

  function icon(){
    return '<svg class="tb-ico" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">'
      + '<circle class="sun" cx="10" cy="10" r="3.4"/><path class="sun" d="M10 1.6v2.2M10 16.2v2.2M1.6 10h2.2M16.2 10h2.2M4.1 4.1l1.5 1.5M14.4 14.4l1.5 1.5M15.9 4.1l-1.5 1.5M5.6 14.4l-1.5 1.5"/>'
      + '<path class="moon" d="M13.6 2.4a7.2 7.2 0 1 0 4 12.8A7.4 7.4 0 0 1 13.6 2.4z" fill="currentColor" stroke="none"/>'
      + '</svg>';
  }

  function addToggle(){
    var anchor = document.querySelector('.page-sticker');
    if(!anchor || document.querySelector('.theme-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = icon() + '<span class="tb-label">深色</span>';
    btn.addEventListener('click', function(){ setTheme(current() === 'dark' ? 'light' : 'dark'); });
    anchor.insertAdjacentElement('afterend', btn);
    setTheme(current());
  }

  /* 首页封面「关于」纸卡由服务端渲染成 HTML，这里只补入场动画的序号。 */
  function staggerAbout(){
    var el = document.getElementById('aboutBody');
    if(!el) return;
    Array.prototype.forEach.call(el.children, function(k, i){ k.style.setProperty('--ai', i); });
  }

  function initTheme(){
    var q = null;
    try { q = new URLSearchParams(location.search).get('theme'); } catch(e){}
    if(q === 'dark' || q === 'light'){ root.dataset.theme = q; }
    if(!root.dataset.theme){
      var stored = null;
      try { stored = localStorage.getItem(KEY); } catch(e){}
      if(stored === 'dark' || stored === 'light') root.dataset.theme = stored;
      else if(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) root.dataset.theme = 'dark';
    }
    setTheme(current());
  }

  /* 剧透：点击或键盘展开；CSS 也支持 hover / focus 临时查看。 */
  function toggleSpoiler(event) {
    var el = event.target && event.target.closest ? event.target.closest('.spoiler') : null;
    if (!el) return;
    el.classList.toggle('is-open');
  }
  document.addEventListener('click', toggleSpoiler);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var el = event.target && event.target.closest ? event.target.closest('.spoiler') : null;
    if (!el) return;
    event.preventDefault();
    el.classList.toggle('is-open');
  });

  /* GitHub 仓库卡片：静态输出版本；打开页面后补 star / fork，缓存 24 小时。
     取不到数据时保留「—」，不阻塞页面。 */
  var REPO_CACHE_PREFIX = 'myon-repo:';
  var REPO_CACHE_TTL = 24 * 60 * 60 * 1000;

  function compactNumber(value) {
    try {
      return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch (e) {
      return String(value);
    }
  }
  function readRepoCache(repo) {
    try {
      var raw = localStorage.getItem(REPO_CACHE_PREFIX + repo.toLowerCase());
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || typeof parsed.fetchedAt !== 'number') return null;
      if (Date.now() - parsed.fetchedAt >= REPO_CACHE_TTL) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  }
  function writeRepoCache(repo, data) {
    try {
      localStorage.setItem(REPO_CACHE_PREFIX + repo.toLowerCase(), JSON.stringify({ data: data, fetchedAt: Date.now() }));
    } catch (e) {}
  }
  function fillRepoCard(card) {
    var repo = card.getAttribute('repo');
    if (!repo || card.getAttribute('data-repo-ready') === '1') return;
    card.setAttribute('data-repo-ready', '1');
    var stars = card.querySelector('[data-repo-stat="stars"]');
    var forks = card.querySelector('[data-repo-stat="forks"]');
    function apply(data) {
      if (!data) return;
      if (stars && typeof data.stargazers_count === 'number') stars.textContent = compactNumber(data.stargazers_count);
      if (forks && typeof data.forks === 'number') forks.textContent = compactNumber(data.forks);
    }
    var cached = readRepoCache(repo);
    if (cached) { apply(cached); return; }
    var signal;
    try { signal = AbortSignal.timeout(5000); } catch (e) { signal = undefined; }
    fetch('https://api.github.com/repos/' + repo, { referrerPolicy: 'no-referrer', signal: signal })
      .then(function (res) {
        if (!res.ok) throw new Error('github ' + res.status);
        return res.json();
      })
      .then(function (data) {
        apply(data);
        writeRepoCache(repo, data);
      })
      .catch(function () {});
  }
  function enhanceRepoCards() {
    Array.prototype.forEach.call(document.querySelectorAll('.repo-card[repo]'), fillRepoCard);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ initTheme(); addToggle(); staggerAbout(); enhanceRepoCards(); });
  } else {
    initTheme(); addToggle(); staggerAbout(); enhanceRepoCards();
  }

  /* 媒体只从 R2 读取：对象缺失时不要显示破图图标，让相框保留纸面。 */
  document.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target.tagName === 'IMG') target.classList.add('is-missing');
  }, true);

  window.MyonTheme = { set: setTheme, current: current };
})();
