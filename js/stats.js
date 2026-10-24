/* ===========================================================
   stats.js —— 统计量（Mean / Median / Std / Range / Nu% ...）
   纯函数，无 DOM 依赖，可在 Node 里直接测
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};

  /** 线性插值分位数 */
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * 统计汇总
   * Std 用样本标准差（n−1，与 JMP / 量测机台口径一致）
   * Nu% = Std / |Mean| × 100
   */
  WM.stat = function (values) {
    var v = [], i;
    for (i = 0; i < values.length; i++) {
      var x = values[i];
      if (typeof x === 'number' && isFinite(x)) v.push(x);
    }
    var n = v.length;
    if (!n) {
      return { n: 0, mean: NaN, median: NaN, std: NaN, min: NaN, max: NaN, range: NaN, nu: NaN, p25: NaN, p75: NaN, sum: 0 };
    }
    var sum = 0;
    for (i = 0; i < n; i++) sum += v[i];
    var mean = sum / n;

    var ss = 0;
    for (i = 0; i < n; i++) { var d = v[i] - mean; ss += d * d; }
    var std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;

    var sorted = v.slice().sort(function (a, b) { return a - b; });
    var med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    var min = sorted[0], max = sorted[n - 1];

    return {
      n: n,
      sum: sum,
      mean: mean,
      median: med,
      std: std,
      min: min,
      max: max,
      range: max - min,
      nu: Math.abs(mean) > 0 ? std / Math.abs(mean) * 100 : NaN,
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75)
    };
  };

  /** 规格内比例（%）；spec = {lsl, usl}，未设则 NaN */
  WM.inSpec = function (values, spec) {
    if (!spec || (!isFinite(spec.lsl) && !isFinite(spec.usl))) return { pct: NaN, pass: NaN, total: 0 };
    var pass = 0, total = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!isFinite(v)) continue;
      total++;
      if (isFinite(spec.lsl) && v < spec.lsl) continue;
      if (isFinite(spec.usl) && v > spec.usl) continue;
      pass++;
    }
    return { pct: total ? pass / total * 100 : NaN, pass: pass, total: total };
  };

  /** 最小二乘线性拟合 y = a + b·x，返回 {a, b, r2} */
  WM.linfit = function (xs, ys) {
    var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i], y = ys[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
    }
    if (n < 2) return { a: NaN, b: NaN, r2: NaN, n: n };
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return { a: sy / n, b: 0, r2: 0, n: n };
    var b = (n * sxy - sx * sy) / den;
    var a = (sy - b * sx) / n;
    var num = n * sxy - sx * sy;
    var r2 = (num * num) / ((n * sxx - sx * sx) * (n * syy - sy * sy));
    return { a: a, b: b, r2: isFinite(r2) ? r2 : NaN, n: n };
  };

  /** 径向分箱均值：返回 [{r, mean, n, std}] */
  WM.radialBins = function (radii, values, binWidth) {
    if (!binWidth || binWidth <= 0) binWidth = 10;
    var buckets = {};
    for (var i = 0; i < radii.length; i++) {
      if (!isFinite(radii[i]) || !isFinite(values[i])) continue;
      var k = Math.floor(radii[i] / binWidth);
      (buckets[k] = buckets[k] || []).push(values[i]);
    }
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    return keys.map(function (k) {
      var arr = buckets[k], s = WM.stat(arr);
      return { r: (k + 0.5) * binWidth, mean: s.mean, n: s.n, std: s.std };
    });
  };

  /** 直方图分箱：返回 [{x0, x1, mid, count}] */
  WM.histogram = function (values, bins) {
    var v = [], i;
    for (i = 0; i < values.length; i++) if (isFinite(values[i])) v.push(values[i]);
    bins = bins || 10;
    if (!v.length) return [];
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    if (min === max) { min -= 0.5; max += 0.5; }
    var w = (max - min) / bins, out = [];
    for (i = 0; i < bins; i++) out.push({ x0: min + i * w, x1: min + (i + 1) * w, mid: min + (i + 0.5) * w, count: 0 });
    for (i = 0; i < v.length; i++) {
      var k = Math.floor((v[i] - min) / w);
      if (k < 0) k = 0;
      if (k >= bins) k = bins - 1;
      out[k].count++;
    }
    return out;
  };

  WM.statLabels = {
    mean: 'Mean', median: 'Median', std: 'Std', range: 'Range',
    nu: 'Nu%', min: 'Min', max: 'Max', n: 'N'
  };
})(typeof window !== 'undefined' ? window : globalThis);
