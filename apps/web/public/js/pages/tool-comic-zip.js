(function () {
  "use strict";

  /* 标准 ZIP（store 模式，不压缩）。漫画页本身已是 JPEG，直接存放原文件即可
     在浏览器里生成标准 .zip，不需要引入压缩库；CRC32 与目录结构按 ZIP 规范
     手写，兼容常见解压工具。 */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var index = 0; index < 256; index += 1) {
      var value = index;
      for (var bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    var crc = 0xffffffff;
    for (var index = 0; index < data.length; index += 1) {
      crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function u16(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
  }

  function u32(value) {
    return new Uint8Array([
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    ]);
  }

  /** 由 [{ name, data: Uint8Array }] 生成 store 模式的 ZIP Blob。 */
  function buildZip(entries, now) {
    var encoder = new TextEncoder();
    var stamp = dosDateTime(now || new Date());
    var parts = [];
    var central = [];
    var offset = 0;

    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var nameBytes = encoder.encode(entry.name);
      var crc = crc32(entry.data);
      var size = entry.data.length;

      var local = [
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(stamp.time),
        u16(stamp.date),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
      ];
      var localSize = 0;
      for (var partIndex = 0; partIndex < local.length; partIndex += 1) {
        localSize += local[partIndex].length;
      }

      parts.push.apply(parts, local);
      parts.push(entry.data);

      central.push(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(stamp.time),
        u16(stamp.date),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      );

      offset += localSize + size;
    }

    var centralSize = 0;
    for (var centralIndex = 0; centralIndex < central.length; centralIndex += 1) {
      centralSize += central[centralIndex].length;
    }

    parts.push.apply(parts, central);
    parts.push(
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(entries.length),
      u16(entries.length),
      u32(centralSize),
      u32(offset),
      u16(0)
    );

    return new Blob(parts, { type: "application/zip" });
  }

  /** 让字符串可以安全出现在 ZIP 内路径 / 下载文件名里。 */
  function sanitizeFileName(input, fallback) {
    var cleaned = String(input == null ? "" : input)
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 120)
      .trim();
    return cleaned || fallback || "download";
  }

  /** 触发一次浏览器下载。 */
  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  window.MyonComicZip = {
    crc32: crc32,
    buildZip: buildZip,
    sanitizeFileName: sanitizeFileName,
    downloadBlob: downloadBlob,
  };
})();
