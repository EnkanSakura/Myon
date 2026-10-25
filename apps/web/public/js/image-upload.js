(function () {
  "use strict";

  /* ==========================================================================
     上传前的统一图片处理：
     - WebP / AVIF / SVG：原样上传（SVG 是唯一例外，不做栅格化）
     - GIF：交给站内 Worker 代理调 img2webp，拿回 animated WebP 再上传
     - JPEG / PNG：浏览器 Canvas 转 WebP（q85，最长边 2560px）
     ========================================================================== */

  var TOKEN_KEY = "myon-admin-token";
  var WEBP_QUALITY = 0.85;
  var MAX_SIDE = 2560;
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  var GIF_ERRORS = {
    img2webp_not_configured: "服务端没有配置 GIF 转码令牌",
    img2webp_failed: "GIF 转码服务请求失败",
    img2webp_invalid_content_type: "GIF 转码服务返回的不是 WebP",
    gif_required: "不是有效的 GIF 文件",
    gif_too_large: "GIF 超过 20MB 上限",
    gif_webp_too_large: "转换后的 WebP 超过 8MB 上限"
  };

  function readToken() {
    try {
      return (localStorage.getItem(TOKEN_KEY) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function extensionOf(name) {
    var match = /\.([a-z0-9]+)$/i.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function webpName(name) {
    var base = String(name || "image").replace(/\.[a-z0-9]+$/i, "");
    return (base || "image") + ".webp";
  }

  function isGif(file) {
    return file.type === "image/gif" || extensionOf(file.name) === "gif";
  }

  function isRaster(file) {
    return (
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      ["jpg", "jpeg", "png"].indexOf(extensionOf(file.name)) !== -1
    );
  }

  function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file).then(function (bitmap) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: function () {
            if (bitmap.close) bitmap.close();
          }
        };
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          release: function () { URL.revokeObjectURL(url); }
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败"));
      };
      image.src = url;
    });
  }

  function canvasToWebp(canvas) {
    return new Promise(function (resolve, reject) {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("浏览器不支持 Canvas 转 WebP"));
        return;
      }
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("浏览器没有生成 WebP"));
            return;
          }
          if (blob.type && blob.type !== "image/webp") {
            reject(new Error("浏览器不支持 WebP 编码"));
            return;
          }
          resolve(blob);
        },
        "image/webp",
        WEBP_QUALITY
      );
    });
  }

  function toWebp(file) {
    return loadBitmap(file).then(function (bitmap) {
      var scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      var width = Math.max(1, Math.round(bitmap.width * scale));
      var height = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext("2d");
      if (!context) {
        bitmap.release();
        throw new Error("浏览器无法创建图片画布");
      }
      context.drawImage(bitmap.source, 0, 0, width, height);
      bitmap.release();
      return canvasToWebp(canvas);
    }).then(function (blob) {
      return new File([blob], webpName(file.name), {
        type: "image/webp",
        lastModified: file.lastModified || Date.now(),
      });
    });
  }

  function gifToWebp(file, gifApi) {
    var token = readToken();
    if (!token) {
      return Promise.reject(new Error("请先填写管理令牌"));
    }
    if (!gifApi) {
      return Promise.reject(new Error("GIF 转码接口未配置"));
    }
    var form = new FormData();
    form.append("file", file, file.name || "image.gif");
    return fetch(gifApi, {
      method: "POST",
      headers: {
        accept: "image/webp",
        "x-admin-token": token,
      },
      body: form,
    }).then(function (response) {
      return response.arrayBuffer().then(function (body) {
        return { response: response, body: body };
      });
    }).then(function (result) {
      if (!result.response.ok) {
        var code = "";
        try {
          code = JSON.parse(new TextDecoder().decode(result.body)).error;
        } catch (error) {
          code = "";
        }
        throw new Error(GIF_ERRORS[code] || "GIF 转码失败（HTTP " + result.response.status + "）");
      }
      var blob = new Blob([result.body], { type: "image/webp" });
      return new File([blob], webpName(file.name), {
        type: "image/webp",
        lastModified: file.lastModified || Date.now(),
      });
    });
  }

  /**
   * 把文件转成最终可上传的文件。
   * options.gifApi：本站 GIF 转码代理地址；其余类型不需要。
   */
  function prepareImage(file, options) {
    options = options || {};
    if (!file) {
      return Promise.reject(new Error("没有选择文件"));
    }
    if (
      file.type === "image/webp" ||
      file.type === "image/avif" ||
      file.type === "image/svg+xml"
    ) {
      return Promise.resolve(file);
    }
    if (isGif(file)) {
      return gifToWebp(file, options.gifApi);
    }
    if (isRaster(file)) {
      return toWebp(file);
    }
    return Promise.reject(new Error("仅支持 JPEG / PNG / GIF / WebP / AVIF / SVG"));
  }

  window.MyonImageUpload = {
    prepareImage: prepareImage,
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    WEBP_QUALITY: WEBP_QUALITY,
    MAX_SIDE: MAX_SIDE
  };
})();
