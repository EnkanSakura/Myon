/* Myon · 全站公共交互：深浅色切换 + 封面「关于」渲染 */
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

  function paintAbout(el, md){
    el.innerHTML = window.MyonMarkdown.render(md);
    Array.prototype.forEach.call(el.children, function(k, i){ k.style.setProperty('--ai', i); });
  }
  function renderAbout(){
    var el = document.getElementById('aboutBody');
    if(!el || !window.MyonMarkdown) return;
    // 先立即可用：本机草稿 / 默认内容；随后以 D1 的 /api/v1/about 为准。
    var local = null;
    try { local = localStorage.getItem('myon-about'); } catch(e){}
    paintAbout(el, local || window.MYON_ABOUT_DEFAULT || '');
    fetch('/api/v1/about', { headers: { accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){ if(data && data.markdown) paintAbout(el, data.markdown); })
      .catch(function(){ /* 本地开发未迁移 D1 时保留草稿/默认内容 */ });
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

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ initTheme(); addToggle(); renderAbout(); });
  } else {
    initTheme(); addToggle(); renderAbout();
  }

  window.MyonTheme = { set: setTheme, current: current };
  window.MyonAbout = { render: renderAbout };
})();
