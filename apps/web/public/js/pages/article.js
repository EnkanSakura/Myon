(function(){
  var body = document.querySelector('.body');
  if (!body) return; // 404 状态页没有正文，跳过阅读进度与复制按钮
  var bar = document.getElementById('readbar');
  var pct = document.getElementById('pct');
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  var heads = Array.prototype.slice.call(document.querySelectorAll('.body h2[id]'));
  function onScroll(){
    var rect = body.getBoundingClientRect();
    var total = rect.height - window.innerHeight * 0.6;
    var passed = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    var p = Math.round(passed / Math.max(total, 1) * 100);
    bar.style.width = p + '%';
    pct.textContent = p + '%';
    var band = window.innerHeight * 0.33;
    var current = heads[0];
    heads.forEach(function(h){ if(h.getBoundingClientRect().top < band) current = h; });
    tocLinks.forEach(function(a){ a.classList.toggle('on', current && a.getAttribute('href') === '#' + current.id); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var toast = document.getElementById('toast'), timer;
  function showToast(text){ toast.textContent = text; toast.classList.add('show'); clearTimeout(timer); timer = setTimeout(function(){ toast.classList.remove('show'); }, 3200); }

  Array.prototype.forEach.call(document.querySelectorAll('.code-h'), function(h){
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'copy'; btn.textContent = '复制';
    btn.addEventListener('click', function(){
      var pre = h.parentElement.querySelector('pre');
      var text = pre ? pre.innerText : '';
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text); }
      showToast('已复制：' + (h.querySelector('.fname') ? h.querySelector('.fname').textContent : '代码'));
    });
    h.appendChild(btn);
  });
})();
