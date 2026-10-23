(function () {
  "use strict";

  /* 封面经站内代理加载；代理失败时显示 .record-cover.is-missing 的占位文字。 */
  Array.prototype.forEach.call(
    document.querySelectorAll("img[data-cover]"),
    function (img) {
      function fail() {
        var frame = img.closest(".record-cover");
        if (frame) frame.classList.add("is-missing");
        img.remove();
      }
      if (img.complete && img.naturalWidth === 0) {
        fail();
        return;
      }
      img.addEventListener("error", fail, { once: true });
    },
  );
})();
