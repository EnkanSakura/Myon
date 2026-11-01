(function () {
  "use strict";

  /* ==========================================================================
     Myon · 媒体图片转换地址（后台共享，ES5 IIFE，不参与打包）

     站内图片统一走 GET /media/<key>?size=<长边像素>&q=<1-100>：
     Worker 用 Cloudflare Images 生成低分辨率 WebP，转换失败 / 本地不支持 / 原图
     本来更小时自动回退原图（不会破图）。size=orig 表示保持原图。

     只处理站内媒体地址（/media/…、旧 /assets/…，以及用 mediaUrl() 的 base
     拼出来的相对路径）；外链 http(s) / 协议相对地址与空值一律原样返回。

     用法（由 AdminLayout 统一引入，页面脚本直接读 window.MyonImage）：
       MyonImage.withSize("/media/a.webp", "720")        // → ?size=720&q=80
       MyonImage.withSize("/media/a.webp", "orig")       // → ?size=orig
       MyonImage.content("/media/a.webp")                // 缺省 720 / q80
       MyonImage.preview("/media/a.webp", 320)           // 缩略图，缺省 360 / q70
       MyonImage.label("orig")                           // → "原图"
       MyonImage.describe("1080")                        // → "长边 1080px"
     ========================================================================== */

  // 尺寸档位兜底：页面通常从 @myon/shared 的 mediaImageSizes 渲染 data-image-sizes，
  // 这里只是共享脚本拿不到页面属性时的兜底，避免选择器空掉。
  var SIZES = ["480", "720", "1080", "1440", "orig"];
  var DEFAULT_SIZE = "720";
  var DEFAULT_QUALITY = 80;
  var DEFAULT_PREVIEW_WIDTH = 360;
  var PREVIEW_QUALITY = 70;

  // 选择器 / 尺寸栏的显示文案：数字就是长边像素，orig 写「原图」。
  var LABELS = {
    "480": "480",
    "720": "720",
    "1080": "1080",
    "1440": "1440",
    orig: "原图"
  };

  /** 只认站内媒体地址：/media/…、旧 /assets/…、media/…、./media/…。 */
  function isStationMedia(url) {
    if (!url) return false;
    // 外链（http / https / 协议相对）不转换，保持原样。
    if (/^(https?:)?\/\//i.test(url)) return false;
    return /^\.?\/?(?:assets|media)\//i.test(url);
  }

  /** 统一成字符串：null / undefined / 非字符串都安全处理，不抛异常。 */
  function toText(value) {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : String(value);
  }

  /** 把大小档位归一化成合法值；非法值返回空串（调用方按缺省处理）。 */
  function normalizeSize(size) {
    var value = toText(size);
    if (!value) return "";
    return value === "orig" || /^\d+$/.test(value) ? value : "";
  }

  /** 质量归一化成 1–100 的整数；非法值用缺省质量。 */
  function normalizeQuality(quality) {
    var value = parseInt(quality, 10);
    if (!isFinite(value) || value < 1) return DEFAULT_QUALITY;
    return value > 100 ? 100 : value;
  }

  /**
   * 给站内媒体地址追加转换参数。
   * - 外链 / 空值 / 非站内地址：原样返回
   * - 地址里已经有 size= 参数：不重复追加
   * - size === "orig"：只加 size=orig（和缺省 720 区分）
   * - 数字 size：加 size=<长边像素>&q=<质量>
   */
  function withSize(src, size, quality) {
    var url = toText(src);
    if (!url || !isStationMedia(url)) return url;
    if (/[?&]size=/.test(url)) return url;

    // 缺省档位用 720，和内容图默认值保持一致。
    var edgeSize = normalizeSize(size);
    if (!edgeSize) edgeSize = DEFAULT_SIZE;

    var separator = url.indexOf("?") >= 0 ? "&" : "?";
    if (edgeSize === "orig") return url + separator + "size=orig";
    return (
      url +
      separator +
      "size=" +
      edgeSize +
      "&q=" +
      normalizeQuality(quality)
    );
  }

  /** 内容图片地址：缺省长边 720px、质量 80。 */
  function content(src, size) {
    return withSize(src, size, DEFAULT_QUALITY);
  }

  /** 后台缩略图地址：缺省长边 360px、质量 70（列表 / 网格预览一律低清）。 */
  function preview(src, width) {
    var edge = parseInt(width, 10);
    if (!isFinite(edge) || edge <= 0) edge = DEFAULT_PREVIEW_WIDTH;
    return withSize(src, edge, PREVIEW_QUALITY);
  }

  /** 尺寸档位文案：orig →「原图」，数字原样。 */
  function label(size) {
    var value = normalizeSize(size) || DEFAULT_SIZE;
    return LABELS[value] || value;
  }

  /** 尺寸档位的可读描述：「长边 720px」/「原图」。 */
  function describe(size) {
    var value = normalizeSize(size) || DEFAULT_SIZE;
    return value === "orig" ? LABELS.orig : "长边 " + value + "px";
  }

  /**
   * 解析页面渲染的 data-image-sizes（JSON 数组），容错：
   * 解析失败或为空时回退兜底档位，非法项丢弃。
   */
  function parseSizes(raw) {
    var parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      parsed = null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return SIZES.slice();
    var list = [];
    for (var i = 0; i < parsed.length; i += 1) {
      var value = normalizeSize(parsed[i]);
      if (value && list.indexOf(value) < 0) list.push(value);
    }
    return list.length ? list : SIZES.slice();
  }

  window.MyonImage = {
    SIZES: SIZES,
    LABELS: LABELS,
    DEFAULT_SIZE: DEFAULT_SIZE,
    DEFAULT_QUALITY: DEFAULT_QUALITY,
    PREVIEW_QUALITY: PREVIEW_QUALITY,
    withSize: withSize,
    content: content,
    preview: preview,
    label: label,
    describe: describe,
    parseSizes: parseSizes
  };
})();
