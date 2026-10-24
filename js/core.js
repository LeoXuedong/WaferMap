/* ===========================================================
   core.js —— 工具函数 / CSV 解析 / 数据集构建 / 色阶
   无依赖，经典 <script>，挂到 window.WM
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  WM.VERSION = '1.0.0';

  /* ---------------- 数值与格式化 ---------------- */
  var util = WM.util = {
    digits: 3,

    /** 统一数字格式化：null/NaN → '—'，去掉 -0，固定小数位 */
    fmt: function (v, d) {
      if (typeof v !== 'number' || !isFinite(v)) return '—';
      if (d === undefined || d === null) d = util.digits;
      var s = v.toFixed(d);
      if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
      return s;
    },

    /** 宽松数值解析（空 / NA / #N/A / -- 视为 NaN） */
    num: function (s) {
      if (typeof s === 'number') return isFinite(s) ? s : NaN;
      if (s === null || s === undefined) return NaN;
      var t = String(s).trim();
      if (t === '' || t === '-' || t === '--' || /^(na|nan|null|n\/a|#n\/a)$/i.test(t)) return NaN;
      var v = Number(t);
      return isFinite(v) ? v : NaN;
    },

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },

    /** 保留 d 位（四舍五入，非字符串） */
    round: function (v, d) {
      var p = Math.pow(10, d === undefined ? 0 : d);
      return Math.round(v * p) / p;
    },

    /** HTML 转义（拼字符串进 innerHTML 时用） */
    esc: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** 相对亮度（0..1），用于决定符号颜色 */
    luminance: function (rgb) {
      var c = [rgb[0], rgb[1], rgb[2]].map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    },

    /** ECharts 实例：统一初始化（canvas 渲染、关动画，保证导出一致） */
    initChart: function (el) {
      var inst = global.echarts.init(el, null, { renderer: 'canvas', width: 'auto', height: 'auto' });
      inst.setOption({ animation: false, textStyle: { fontFamily: 'inherit' } });
      return inst;
    },

    /** 卡片尺寸变化时重排（ResizeObserver 兜底） */
    observeResize: function (el, fn) {
      if (!global.ResizeObserver) { global.addEventListener('resize', fn); return null; }
      var ro = new global.ResizeObserver(function () { fn(); });
      ro.observe(el);
      return ro;
    }
  };

  /* ---------------- CSV 解析（RFC4180 状态机） ---------------- */
  WM.detectDelimiter = function (text) {
    var sample = text.slice(0, 4000).split('\n').slice(0, 5).join('\n');
    var cands = [',', '\t', ';', '|'];
    var best = ',', bestN = -1;
    for (var i = 0; i < cands.length; i++) {
      var n = 0, inQ = false;
      for (var j = 0; j < sample.length; j++) {
        var c = sample[j];
        if (c === '"') inQ = !inQ;
        else if (c === cands[i] && !inQ) n++;
      }
      if (n > bestN) { bestN = n; best = cands[i]; }
    }
    return bestN > 0 ? best : ',';
  };

  WM.parseCSV = function (text, delimiter) {
    if (typeof text !== 'string') throw new Error('CSV 内容为空');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (!delimiter || delimiter === 'auto') delimiter = WM.detectDelimiter(text);
    var rows = [], row = [], field = '', inQ = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === delimiter) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    while (rows.length) {
      var last = rows[rows.length - 1];
      var empty = true;
      for (var k = 0; k < last.length; k++) if (String(last[k]).trim() !== '') { empty = false; break; }
      if (empty) rows.pop(); else break;
    }
    if (!rows.length) throw new Error('CSV 中没有可解析的行');
    return rows;
  };

  /* ---------------- 数据集构建 ----------------
     默认布局：第 1、2 列 = 坐标（X, Y），第 3 列起 = 膜厚数据列
     表头自动识别；也可由调用方显式指定 xCol / yCol / valueCols
  --------------------------------------------- */
  WM.buildDataset = function (rawRows, opts) {
    opts = opts || {};
    if (!rawRows || rawRows.length < 2) throw new Error('数据行不足（至少需要表头 + 1 行数据）');

    var headerRow = rawRows[0];
    var hasHeader = opts.hasHeader;
    if (hasHeader === undefined || hasHeader === null) {
      hasHeader = headerRow.some(function (c) {
        var s = String(c).trim();
        return s !== '' && !isFinite(util.num(s));
      });
    }
    var dataRows = hasHeader ? rawRows.slice(1) : rawRows;
    var ncol = 0;
    dataRows.forEach(function (r) { if (r.length > ncol) ncol = r.length; });

    var names = [];
    for (var c = 0; c < ncol; c++) {
      var h = hasHeader && headerRow[c] !== undefined ? String(headerRow[c]).trim() : '';
      names.push(h !== '' ? h : 'C' + (c + 1));
    }

    var hits = new Array(ncol).fill(0);
    var filled = new Array(ncol).fill(0);
    dataRows.forEach(function (r) {
      for (var i = 0; i < ncol; i++) {
        var cell = r[i];
        if (cell === undefined || String(cell).trim() === '') continue;
        filled[i]++;
        if (isFinite(util.num(cell))) hits[i]++;
      }
    });
    // 数值列判定：非空单元格中 ≥60% 可解析为数字（容忍偶发缺测/空值）
    var numeric = hits.map(function (k, i) {
      return k > 0 && k >= Math.ceil(filled[i] * 0.6);
    });

    var xCol = opts.xCol, yCol = opts.yCol, valueCols = opts.valueCols;
    if (xCol === undefined || xCol === null || xCol < 0) {
      xCol = -1;
      for (var i = 0; i < ncol; i++) if (numeric[i]) { xCol = i; break; }
      if (xCol < 0) xCol = 0;
    }
    if (yCol === undefined || yCol === null || yCol < 0) {
      yCol = -1;
      for (var j = 0; j < ncol; j++) if (numeric[j] && j !== xCol) { yCol = j; break; }
      if (yCol < 0) yCol = Math.min(1, ncol - 1);
    }
    if (!valueCols || !valueCols.length) {
      valueCols = [];
      for (var k2 = 0; k2 < ncol; k2++) {
        if (k2 !== xCol && k2 !== yCol && numeric[k2]) valueCols.push(k2);
      }
    }
    if (!valueCols.length) throw new Error('未找到膜厚数据列（除坐标列外需要至少一列数值）');

    return {
      hasHeader: hasHeader,
      names: names,
      numeric: numeric,
      ncol: ncol,
      rowCount: dataRows.length,
      xCol: xCol,
      yCol: yCol,
      valueCols: valueCols,
      valueNames: valueCols.map(function (i) { return names[i]; }),
      rows: dataRows
    };
  };

  /** 由数据集抽出点：{x, y, v:[...]}，坐标非法或全值非法的行丢弃 */
  WM.makePoints = function (ds) {
    var pts = [], skipped = 0;
    for (var r = 0; r < ds.rows.length; r++) {
      var row = ds.rows[r];
      var x = util.num(row[ds.xCol]), y = util.num(row[ds.yCol]);
      if (!isFinite(x) || !isFinite(y)) { skipped++; continue; }
      var v = ds.valueCols.map(function (ci) { return util.num(row[ci]); });
      var any = false;
      for (var i = 0; i < v.length; i++) if (isFinite(v[i])) { any = true; break; }
      if (!any) { skipped++; continue; }
      pts.push({ x: x, y: y, v: v });
    }
    return { points: pts, skipped: skipped };
  };

  /** 取某一数值列的 {values, xs, ys, radii}（跳过 NaN） */
  WM.extractColumn = function (points, ci) {
    var xs = [], ys = [], vs = [], rs = [], idx = [];
    for (var i = 0; i < points.length; i++) {
      var v = points[i].v[ci];
      if (!isFinite(v)) continue;
      xs.push(points[i].x); ys.push(points[i].y); vs.push(v);
      rs.push(Math.sqrt(points[i].x * points[i].x + points[i].y * points[i].y));
      idx.push(i);
    }
    return { xs: xs, ys: ys, values: vs, radii: rs, index: idx, ci: ci };
  };

  /** 全数据集的每列统计（走 WM.stat） */
  WM.summarize = function (points, valueCount) {
    var out = [];
    for (var c = 0; c < valueCount; c++) {
      var col = WM.extractColumn(points, c);
      out.push(WM.stat(col.values));
    }
    return out;
  };

  /* ---------------- 色阶 ---------------- */
  var SCALES = {
    viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
    turbo: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#cb2a04', '#7a0403'],
    // MATLAB jet(256) 的 33 点采样：控制点更密 → 渐变更均匀、无色带断层
    jet: ['#000083', '#0000a3', '#0000c3', '#0000e3', '#0004ff', '#0024ff', '#0044ff', '#0064ff', '#0083ff', '#00a3ff', '#00c3ff', '#00e3ff', '#04fffb', '#24ffdb', '#44ffbb', '#64ff9b', '#83ff7c', '#9fff60', '#bfff40', '#dfff20', '#ffff00', '#ffdf00', '#ffbf00', '#ff9f00', '#ff8000', '#ff6000', '#ff4000', '#ff2000', '#ff0000', '#df0000', '#bf0000', '#9f0000', '#800000'],
    thermal: ['#000004', '#4b0c6b', '#a02c5a', '#e35933', '#f98e09', '#f9d847', '#fcfdbf'],
    plasma: ['#0d0887', '#5c01a6', '#9c179e', '#cc4778', '#ed7953', '#fdb42f', '#f0f921'],
    coolwarm: ['#3b4cc0', '#6a8fe0', '#a8c4f0', '#dddddd', '#f0b8a8', '#e07a6a', '#b40426'],
    rdylbu: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    cividis: ['#002051', '#123570', '#4a4a6e', '#6f6f6d', '#9b9b6f', '#c8c875', '#f4f4a8'],
    gray: ['#ffffff', '#d0d0d0', '#909090', '#505050', '#0a0a0a']
  };

  WM.scales = Object.keys(SCALES);
  WM.scaleLabel = {
    viridis: 'Viridis', turbo: 'Turbo', jet: 'Jet', thermal: 'Thermal',
    plasma: 'Plasma', coolwarm: 'Cool-Warm', rdylbu: 'RdYlBu', cividis: 'Cividis', gray: 'Gray'
  };

  function hex2rgb(h) {
    var s = h.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  WM.stops = function (name) {
    return (SCALES[name] || SCALES.viridis).map(hex2rgb);
  };

  /**
   * 生成颜色映射函数
   * @returns {function(t:number):number[]}  t∈[0,1] → [r,g,b]
   */
  WM.makeRamp = function (name, reverse, levels) {
    var stops = WM.stops(name);
    if (reverse) stops = stops.slice().reverse();
    return function (t) {
      if (!isFinite(t)) t = 0;
      t = util.clamp(t, 0, 1);
      if (levels && levels > 1) {
        var idx = Math.min(levels - 1, Math.floor(t * levels));
        t = levels > 1 ? idx / (levels - 1) : t;
      }
      var p = t * (stops.length - 1), i0 = Math.floor(p), i1 = Math.min(stops.length - 1, i0 + 1), f = p - i0;
      var a = stops[i0], b = stops[i1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    };
  };

  WM.rgbCss = function (c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; };

  /** CSS 渐变串（用于色阶条 / 色板） */
  WM.cssGradient = function (name, reverse, angle) {
    var stops = WM.stops(name);
    if (reverse) stops = stops.slice().reverse();
    var parts = stops.map(function (c, i) {
      return WM.rgbCss(c) + ' ' + (100 * i / (stops.length - 1)).toFixed(1) + '%';
    });
    return 'linear-gradient(' + (angle || '90deg') + ',' + parts.join(',') + ')';
  };

  /* ---------------- 领域范围 ---------------- */
  /** 色阶定义域：mode = 'auto'（单图 min/max）| 'global'（所有列）| 'manual' */
  WM.colorDomain = function (state, values) {
    var mode = state.scale.domain, lo, hi;
    if (mode === 'manual' && isFinite(state.scale.min) && isFinite(state.scale.max) && state.scale.max > state.scale.min) {
      lo = state.scale.min; hi = state.scale.max;
    } else if (mode === 'global' && state.globalRange) {
      lo = state.globalRange.min; hi = state.globalRange.max;
    } else {
      lo = Infinity; hi = -Infinity;
      for (var i = 0; i < values.length; i++) {
        var v = values[i];
        if (!isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    }
    if (hi <= lo) { var m = (lo + hi) / 2; lo = m - 0.5; hi = m + 0.5; }
    return { min: lo, max: hi };
  };

  WM.toUnit = function (v, dom) {
    if (!isFinite(v) || !dom || dom.max <= dom.min) return 0;
    return util.clamp((v - dom.min) / (dom.max - dom.min), 0, 1);
  };

  /* ---------------- 其它 ---------------- */
  WM.download = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
  };

  WM.timestamp = function () {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };

  WM.baseName = function (name) {
    return String(name || 'wafermap').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\s]+/g, '_');
  };
})(window);
