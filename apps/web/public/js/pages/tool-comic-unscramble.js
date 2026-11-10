(function () {
  "use strict";

  /* 在浏览器里还原 Champion Cross 的 4x4 页面打乱。
     接口返回的 scramble 是一组排列：源图第 scramble[i] 块应放到目标第 i 块，
     与旧站参考实现保持一致。未打乱的页面原样返回，避免无意义的二次编码。 */

  function blockCopies(scramble, width, height, columns, rows) {
    var cols = columns || 4;
    var rowCount = rows || 4;
    var blockWidth = Math.floor(width / cols);
    var blockHeight = Math.floor(height / rowCount);
    if (blockWidth <= 0 || blockHeight <= 0) {
      return [];
    }

    var copies = [];
    for (var index = 0; index < scramble.length; index += 1) {
      var source = scramble[index];
      if (source === undefined || source < 0 || source >= cols * rowCount) {
        continue;
      }
      var sourceCol = Math.floor(source / cols);
      var sourceRow = source % cols;
      var targetCol = Math.floor(index / cols);
      var targetRow = index % cols;
      copies.push({
        sx: sourceCol * blockWidth,
        sy: sourceRow * blockHeight,
        dx: targetCol * blockWidth,
        dy: targetRow * blockHeight,
        width: blockWidth,
        height: blockHeight,
      });
    }
    return copies;
  }

  function createCanvas(width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("canvas 2d context is unavailable");
    }
    return { canvas: canvas, ctx: ctx };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("canvas.toBlob failed"));
          }
        },
        type,
        quality
      );
    });
  }

  function extensionForType(type) {
    if (type.indexOf("png") !== -1) return "png";
    if (type.indexOf("webp") !== -1) return "webp";
    if (type.indexOf("gif") !== -1) return "gif";
    return "jpg";
  }

  /** 返回 { blob, extension }；打乱的页面重新拼合并编码为 JPEG。 */
  async function unscramblePage(blob, scramble, quality) {
    if (!scramble || !scramble.length) {
      return { blob: blob, extension: extensionForType(blob.type || "") };
    }

    var bitmap = await createImageBitmap(blob);
    try {
      var width = bitmap.width;
      var height = bitmap.height;
      var target = createCanvas(width, height);
      target.ctx.drawImage(bitmap, 0, 0);

      var source = createCanvas(width, height);
      source.ctx.drawImage(bitmap, 0, 0);

      var copies = blockCopies(scramble, width, height);
      for (var index = 0; index < copies.length; index += 1) {
        var copy = copies[index];
        target.ctx.drawImage(
          source.canvas,
          copy.sx,
          copy.sy,
          copy.width,
          copy.height,
          copy.dx,
          copy.dy,
          copy.width,
          copy.height
        );
      }

      var output = await canvasToBlob(target.canvas, "image/jpeg", quality || 0.92);
      return { blob: output, extension: "jpg" };
    } finally {
      if (bitmap.close) {
        bitmap.close();
      }
    }
  }

  window.MyonComicUnscramble = {
    blockCopies: blockCopies,
    unscramblePage: unscramblePage,
  };
})();
