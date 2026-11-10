(function () {
  'use strict';

  /* 工具 · LC 计算器
     谐振回路：f = 1 / (2π√(LC))，L = 1 / ((2πf)²C)，C = 1 / ((2πf)²L)；
     频率匹配：保持电感不变，C₂ = C₁ · (f₁ / f₂)²。
     全部在浏览器内换算，不联网、不上传，也不写 D1 / R2。 */

  var root = document.getElementById('lcTool');
  if (!root) return;

  var QUANTITIES = ['l', 'c', 'f'];
  var RESULT_LABELS = {
    f: '谐振频率 f',
    l: '所需电感 L',
    c: '所需电容 C',
  };

  /* ---------- 单位表与换算（对齐旧站 utils/lc.ts） ---------- */

  var INDUCTANCE_UNITS = [
    { unit: 'H', label: 'H', factor: 1 },
    { unit: 'mH', label: 'mH', factor: 1e-3 },
    { unit: 'uH', label: 'µH', factor: 1e-6 },
    { unit: 'nH', label: 'nH', factor: 1e-9 },
    { unit: 'pH', label: 'pH', factor: 1e-12 },
  ];
  var CAPACITANCE_UNITS = [
    { unit: 'F', label: 'F', factor: 1 },
    { unit: 'mF', label: 'mF', factor: 1e-3 },
    { unit: 'uF', label: 'µF', factor: 1e-6 },
    { unit: 'nF', label: 'nF', factor: 1e-9 },
    { unit: 'pF', label: 'pF', factor: 1e-12 },
  ];
  var FREQUENCY_UNITS = [
    { unit: 'Hz', label: 'Hz', factor: 1 },
    { unit: 'kHz', label: 'kHz', factor: 1e3 },
    { unit: 'MHz', label: 'MHz', factor: 1e6 },
    { unit: 'GHz', label: 'GHz', factor: 1e9 },
  ];

  function factorOf(options, unit) {
    for (var index = 0; index < options.length; index += 1) {
      if (options[index].unit === unit) return options[index].factor;
    }
    return 1;
  }

  function toBase(value, unit, options) {
    return value * factorOf(options, unit);
  }

  /** f = 1 / (2π√(LC))，L 亨利、C 法拉、结果为赫兹。 */
  function resonanceFrequency(inductance, capacitance) {
    if (!(inductance > 0) || !(capacitance > 0)) return NaN;
    return 1 / (2 * Math.PI * Math.sqrt(inductance * capacitance));
  }

  /** L = 1 / ((2πf)² C) */
  function inductanceFor(frequency, capacitance) {
    if (!(frequency > 0) || !(capacitance > 0)) return NaN;
    return 1 / (Math.pow(2 * Math.PI * frequency, 2) * capacitance);
  }

  /** C = 1 / ((2πf)² L) */
  function capacitanceFor(frequency, inductance) {
    if (!(frequency > 0) || !(inductance > 0)) return NaN;
    return 1 / (Math.pow(2 * Math.PI * frequency, 2) * inductance);
  }

  /** C_target = C_current · (f_current / f_target)² */
  function matchedCapacitance(current, from, to) {
    if (!(current > 0) || !(from > 0) || !(to > 0)) return NaN;
    return current * Math.pow(from / to, 2);
  }

  /** 选一个顺眼的工程单位：尾数落在 [1, 1000)。 */
  function toEngineering(value, options, precision) {
    var digits = precision || 6;
    if (!isFinite(value) || value === 0) {
      return {
        value: value,
        unit: options[0] ? options[0].unit : '',
        text: isFinite(value)
          ? '0 ' + (options[0] ? options[0].label : '')
          : '—',
      };
    }

    var magnitude = Math.abs(value);
    var chosen = null;
    for (var index = 0; index < options.length; index += 1) {
      var option = options[index];
      if (magnitude >= option.factor && (!chosen || option.factor > chosen.factor)) {
        chosen = option;
      }
    }
    if (!chosen) chosen = options[options.length - 1];

    var scaled = value / chosen.factor;
    return {
      value: scaled,
      unit: chosen.unit,
      text: Number(scaled.toPrecision(digits)) + ' ' + chosen.label,
    };
  }

  function formatInductance(value) {
    return toEngineering(value, INDUCTANCE_UNITS);
  }
  function formatCapacitance(value) {
    return toEngineering(value, CAPACITANCE_UNITS);
  }
  function formatFrequency(value) {
    return toEngineering(value, FREQUENCY_UNITS);
  }

  /** 容错解析：去掉逗号 / 空白，全角数字与小数点、负号转半角。 */
  function parseNumberInput(input) {
    var cleaned = String(input == null ? '' : input)
      .replace(/[，,\s]/g, '')
      .replace(/[０-９]/g, function (char) {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      })
      .replace(/．/g, '.')
      .replace(/[－ー]/g, '-');
    if (!cleaned) return NaN;
    return Number(cleaned);
  }

  /* ---------- DOM ---------- */

  function byId(id) {
    return document.getElementById(id);
  }

  var els = {
    l: byId('lcL'),
    lUnit: byId('lcLUnit'),
    c: byId('lcC'),
    cUnit: byId('lcCUnit'),
    f: byId('lcF'),
    fUnit: byId('lcFUnit'),
    recalc: byId('lcRecalc'),
    result: byId('lcResult'),
    resultLabel: byId('lcResultLabel'),
    resultText: byId('lcResultText'),
    matchC: byId('lcMatchC'),
    matchCUnit: byId('lcMatchCUnit'),
    matchFrom: byId('lcMatchFrom'),
    matchFromUnit: byId('lcMatchFromUnit'),
    matchTo: byId('lcMatchTo'),
    matchToUnit: byId('lcMatchToUnit'),
    matchResult: byId('lcMatchResult'),
    matchText: byId('lcMatchText'),
  };

  // 其他工具页没有 LC 工作台，脚本直接收工。
  if (!els.l) return;

  var currentResult = null;

  function formatFor(kind, base) {
    if (kind === 'f') return formatFrequency(base);
    if (kind === 'l') return formatInductance(base);
    return formatCapacitance(base);
  }

  /* ---------- 谐振换算：任意两个有效时算第三个 ---------- */

  function updateResonance() {
    var parsed = {
      l: toBase(parseNumberInput(els.l.value), els.lUnit.value, INDUCTANCE_UNITS),
      c: toBase(parseNumberInput(els.c.value), els.cUnit.value, CAPACITANCE_UNITS),
      f: toBase(parseNumberInput(els.f.value), els.fUnit.value, FREQUENCY_UNITS),
    };
    var filled = QUANTITIES.filter(function (quantity) {
      return isFinite(parsed[quantity]) && parsed[quantity] > 0;
    });

    currentResult = null;
    if (filled.length === 2) {
      var missing = QUANTITIES.filter(function (quantity) {
        return filled.indexOf(quantity) < 0;
      })[0];
      var base = NaN;
      if (missing === 'f') {
        base = resonanceFrequency(parsed.l, parsed.c);
      } else if (missing === 'l') {
        base = inductanceFor(parsed.f, parsed.c);
      } else {
        base = capacitanceFor(parsed.f, parsed.l);
      }
      if (isFinite(base) && base > 0) {
        currentResult = { kind: missing, base: base };
      }
    }

    if (!currentResult) {
      els.result.hidden = true;
      els.recalc.disabled = true;
      return;
    }

    var formatted = formatFor(currentResult.kind, currentResult.base);
    currentResult.formatted = formatted;
    els.resultLabel.textContent = RESULT_LABELS[currentResult.kind];
    els.resultText.textContent = formatted.text;
    els.result.hidden = false;
    els.recalc.disabled = false;
  }

  /** 重算：把结果填回对应输入框、切到结果单位，并清空另外两个量。 */
  function applyResult() {
    if (!currentResult) return;
    var formatted = currentResult.formatted;
    var value = isFinite(formatted.value)
      ? String(Number(formatted.value.toPrecision(6)))
      : '';

    if (currentResult.kind === 'l') {
      els.l.value = value;
      els.lUnit.value = formatted.unit;
      els.c.value = '';
      els.f.value = '';
    } else if (currentResult.kind === 'c') {
      els.c.value = value;
      els.cUnit.value = formatted.unit;
      els.l.value = '';
      els.f.value = '';
    } else {
      els.f.value = value;
      els.fUnit.value = formatted.unit;
      els.l.value = '';
      els.c.value = '';
    }
    updateResonance();
  }

  /* ---------- 频率匹配：电容怎么调才能把 f₁ 调到 f₂ ---------- */

  function updateMatch() {
    var capacitance = toBase(
      parseNumberInput(els.matchC.value),
      els.matchCUnit.value,
      CAPACITANCE_UNITS,
    );
    var from = toBase(
      parseNumberInput(els.matchFrom.value),
      els.matchFromUnit.value,
      FREQUENCY_UNITS,
    );
    var to = toBase(
      parseNumberInput(els.matchTo.value),
      els.matchToUnit.value,
      FREQUENCY_UNITS,
    );

    var matched = matchedCapacitance(capacitance, from, to);
    if (!isFinite(matched) || !(matched > 0)) {
      els.matchResult.hidden = true;
      return;
    }
    els.matchText.textContent = formatCapacitance(matched).text;
    els.matchResult.hidden = false;
  }

  /* ---------- 事件绑定 ---------- */

  [els.l, els.c, els.f].forEach(function (input) {
    input.addEventListener('input', updateResonance);
  });
  [els.lUnit, els.cUnit, els.fUnit].forEach(function (select) {
    select.addEventListener('change', updateResonance);
  });
  els.recalc.addEventListener('click', applyResult);

  [els.matchC, els.matchFrom, els.matchTo].forEach(function (input) {
    input.addEventListener('input', updateMatch);
  });
  [els.matchCUnit, els.matchFromUnit, els.matchToUnit].forEach(function (select) {
    select.addEventListener('change', updateMatch);
  });

  updateResonance();
  updateMatch();
})();
