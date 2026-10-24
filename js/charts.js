/* ===========================================================
   charts.js —— ECharts 图表构建（Profile / 直方图 / 统计柱状）
   统一风格：无内部网格线、四边外框、Y 轴贴合数据、数值按位数格式化
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  var U = WM.util;

  var FRAME = '#9aa5b1';
  var TICK = '#5b6672';
  var NAME = '#46515c';
  var SUB = '#8b96a3';

  WM.chartColors = {
    accent: '#0b6e99',
    accent2: '#0f9d8f',
    mean: '#d64541',
    median: '#e08a1e',
    band: 'rgba(11,110,153,0.10)',
    fit: '#8e44ad'
  };

  function pad(vmin, vmax, pct) {
    if (!isFinite(vmin) || !isFinite(vmax)) return { min: 0, max: 1 };
    if (vmax === vmin) { var d = Math.abs(vmin) * 0.05 || 1; return { min: vmin - d, max: vmax + d }; }
    var p = (vmax - vmin) * (pct === undefined ? 0.06 : pct);
    return { min: vmin - p, max: vmax + p };
  }

  /** 坐标轴刻度：按位数格式化，去掉多余的尾随 0（110.000 → 110），避免宽标签互相挤压 */
  function fmtAxis(v, d) {
    if (!isFinite(v)) return '';
    var s = U.fmt(v, d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function dataExtent(series) {
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) {
      (s.data || []).forEach(function (pt) {
        if (Array.isArray(pt) && pt.length === 5) {
          // boxplot: [min, Q1, median, Q3, max] —— 范围必须覆盖 min..max
          if (isFinite(pt[0]) && pt[0] < lo) lo = pt[0];
          if (isFinite(pt[4]) && pt[4] > hi) hi = pt[4];
          return;
        }
        var y = Array.isArray(pt) ? pt[1] : pt;
        if (typeof y === 'number' && isFinite(y)) {
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      });
    });
    return { min: lo, max: hi };
  }

  function dataExtentX(series) {
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) {
      (s.data || []).forEach(function (pt) {
        var x = Array.isArray(pt) ? pt[0] : (s.catIndex || 0);
        if (typeof x === 'number' && isFinite(x)) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      });
    });
    return { min: lo, max: hi };
  }

  /**
   * 通用笛卡尔图
   * cfg = { xType, xName, xMin, xMax, categories, yName, yMin, yMax, yZero,
   *         digits, series, refs, band, legend, grid, yPad, tooltip }
   */
  WM.buildOption = function (cfg) {
    var digits = cfg.digits === undefined ? U.digits : cfg.digits;
    var xType = cfg.xType || 'value';
    var series = (cfg.series || []).filter(function (s) { return s && s.data; });

    // ---- Y 范围 ----
    var ye = dataExtent(series);
    var yMin = cfg.yMin, yMax = cfg.yMax;
    if (!isFinite(yMin) || !isFinite(yMax)) {
      var pr = pad(ye.min, ye.max, cfg.yPad);
      if (!isFinite(yMin)) yMin = pr.min;
      if (!isFinite(yMax)) yMax = pr.max;
      if (cfg.yZero) { yMin = Math.min(0, yMin); }
    }
    if (/count|数量|频数/.test(cfg.yName || '')) yMin = 0;
    (cfg.refs || []).forEach(function (r) {
      if (isFinite(r.value)) { yMin = Math.min(yMin, r.value); yMax = Math.max(yMax, r.value); }
    });
    if (cfg.band && isFinite(cfg.band.from)) { yMin = Math.min(yMin, cfg.band.from); yMax = Math.max(yMax, cfg.band.to); }
    if (yMax <= yMin) { var mid = (yMax + yMin) / 2; yMin = mid - 0.5; yMax = mid + 0.5; }

    // ---- X 范围 ----
    var xMin, xMax;
    if (xType === 'category') {
      var cats = cfg.categories || [];
      xMin = -0.5; xMax = Math.max(0, cats.length - 0.5);
    } else {
      var xe = dataExtentX(series);
      if (!isFinite(cfg.xMin) && !isFinite(cfg.xMax)) {
        var xpr = pad(xe.min, xe.max, 0.03);
        xMin = xpr.min; xMax = xpr.max;
      } else {
        xMin = cfg.xMin; xMax = cfg.xMax;
      }
      if (xMax <= xMin) { xMin = 0; xMax = 1; }
    }

    var g = cfg.grid || {};
    var grid = {
      left: g.left === undefined ? 62 : g.left,
      right: g.right === undefined ? 26 : g.right,
      top: g.top === undefined ? 26 : g.top,
      bottom: g.bottom === undefined ? 46 : g.bottom
    };

    var xAxisMain = {
      type: xType,
      data: xType === 'category' ? (cfg.categories || []) : undefined,
      min: xMin, max: xMax,
      name: cfg.xName || '',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: NAME, fontSize: 11 },
      axisLine: { show: true, onZero: false, lineStyle: { color: FRAME, width: 1 } },
      axisTick: { show: true, length: 4, lineStyle: { color: FRAME } },
      axisLabel: {
        color: TICK, fontSize: 10.5, margin: 6, hideOverlap: true,
        formatter: function (v) { return xType === 'category' ? v : fmtAxis(v, digits); }
      },
      splitLine: { show: false },
      axisPointer: { show: true, lineStyle: { color: 'rgba(11,110,153,0.35)' } }
    };
    var xAxisTop = {
      type: xType,
      data: xType === 'category' ? (cfg.categories || []) : undefined,
      min: xMin, max: xMax,
      position: 'top',
      axisLine: { show: true, onZero: false, lineStyle: { color: FRAME, width: 1 } },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
      axisPointer: { show: false }
    };
    var yAxisMain = {
      type: 'value',
      min: yMin, max: yMax,
      name: cfg.yName || '',
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { color: NAME, fontSize: 11 },
      axisLine: { show: true, onZero: false, lineStyle: { color: FRAME, width: 1 } },
      axisTick: { show: true, length: 4, lineStyle: { color: FRAME } },
      axisLabel: {
        color: TICK, fontSize: 10.5, margin: 6,
        formatter: function (v) { return fmtAxis(v, cfg.yDigits === undefined ? digits : cfg.yDigits); }
      },
      splitLine: { show: false },
      axisPointer: { show: false }
    };
    var yAxisRight = {
      type: 'value',
      min: yMin, max: yMax,
      position: 'right',
      axisLine: { show: true, onZero: false, lineStyle: { color: FRAME, width: 1 } },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
      axisPointer: { show: false }
    };

    // ---- series ----
    var eSerieRefs = [];
    if ((cfg.refs && cfg.refs.length) || (cfg.xRefs && cfg.xRefs.length) || cfg.band) {
      var mlData = [];
      (cfg.refs || []).forEach(function (r) {
        mlData.push({
          yAxis: r.value, name: r.label || '',
          label: { position: 'insideStartTop', fontSize: 10, color: '#5b6672' },
          lineStyle: { color: r.color || '#d64541', type: r.dash === false ? 'solid' : 'dashed', width: 1.2 }
        });
      });
      (cfg.xRefs || []).forEach(function (r) {
        mlData.push({
          xAxis: r.value, name: r.label || '',
          label: r.noLabel ? { show: false } : { position: r.labelPos || 'insideEndTop', fontSize: 10, color: '#5b6672' },
          lineStyle: { color: r.color || '#d64541', type: r.dash === false ? 'solid' : 'dashed', width: 1.2 }
        });
      });
      eSerieRefs.push({
        type: 'line', name: '__ref__', data: [], silent: true, symbol: 'none', z: 1,
        markLine: mlData.length ? {
          silent: true, symbol: 'none', animation: false,
          label: {
            fontSize: 10, color: '#5b6672',
            formatter: function (p) { return p.name || ''; }
          },
          data: mlData
        } : undefined,
        markArea: cfg.band ? {
          silent: true, animation: false,
          itemStyle: { color: cfg.band.color || WM.chartColors.band },
          data: [[{ yAxis: cfg.band.from }, { yAxis: cfg.band.to }]]
        } : undefined
      });
    }

    var seriesOut = eSerieRefs.concat(series.map(function (s) {
      var item = {
        name: s.name || '',
        type: s.type || 'scatter',
        data: s.data,
        clip: true,
        z: s.z === undefined ? 3 : s.z,
        itemStyle: { color: s.color || WM.chartColors.accent, opacity: s.opacity === undefined ? 1 : s.opacity },
        emphasis: { focus: 'none' }
      };
      if (item.type === 'line') {
        item.showSymbol = s.showSymbol !== false;
        item.symbolSize = s.symbolSize || 5;
        item.smooth = false;
        item.lineStyle = { color: s.color || WM.chartColors.accent, width: s.lineWidth || 1.6, type: s.dash ? 'dashed' : 'solid', opacity: s.opacity === undefined ? 1 : s.opacity };
        if (s.area) { item.areaStyle = { color: s.area, opacity: 1 }; }
      }
      if (item.type === 'scatter') {
        item.symbolSize = s.symbolSize || 7;
        item.symbol = s.symbol || 'circle';
      }
      if (item.type === 'bar') {
        item.barWidth = s.barWidth || '58%';
        item.itemStyle.borderRadius = s.radius === undefined ? [2, 2, 0, 0] : s.radius;
        item.itemStyle.opacity = s.opacity === undefined ? 0.92 : s.opacity;
      }
      if (cfg.showValues) {
        var ld = (item.type === 'bar' && cfg.yDigits !== undefined) ? cfg.yDigits : digits;
        item.label = {
          show: true,
          position: 'top',
          fontSize: item.type === 'bar' ? 10 : 9.5,
          color: '#33404d',
          distance: 3,
          textBorderColor: 'rgba(255,255,255,0.9)',   // 细描边：标签互相靠近时仍可读
          textBorderWidth: 2,
          formatter: (function (dd, st) {
            return function (p) {
              if (st > 1 && (p.dataIndex % st) !== 0) return '';
              var val = Array.isArray(p.value) ? p.value[1] : p.value;
              return U.fmt(val, dd);
            };
          })(ld, Math.max(1, cfg.labelStep || 1))
        };
      }
      return item;
    }));

    // legend
    var legendSeries = seriesOut.filter(function (s) { return s.name && s.name !== '__ref__'; });
    var legend = {
      show: cfg.legend !== false && legendSeries.length > 1,
      type: cfg.legendType === 'scroll' ? 'scroll' : 'plain',
      top: 2, left: 'center',
      itemWidth: 12, itemHeight: 8, itemGap: 12,
      textStyle: { color: TICK, fontSize: 10.5 },
      data: legendSeries.map(function (s) { return s.name; })
    };
    if (legend.show) { grid.top = Math.max(grid.top, cfg.legendType === 'scroll' ? 36 : 28); }
    if (cfg.showValues) { grid.top = Math.max(grid.top, 30); }

    var tooltip = {
      trigger: (cfg.xType === 'category') ? 'axis' : 'item',
      confine: true,
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderColor: '#d8dde3', borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: '#26313c', fontSize: 11.5 },
      extraCssText: 'box-shadow:0 4px 14px rgba(20,30,45,0.12);border-radius:4px;',
      formatter: cfg.tooltip || function (p) {
        var arr = Array.isArray(p) ? p : [p];
        var lines = [];
        arr.forEach(function (q) {
          if (q.seriesName === '__ref__') return;
          var v = Array.isArray(q.value) ? q.value[1] : q.value;
          var xv = Array.isArray(q.value) ? q.value[0] : q.name;
          lines.push('<div style="font-size:11px;color:#6b7785">' + U.esc(cfg.xName || 'X') + ' = ' + (typeof xv === 'number' ? U.fmt(xv, digits) : U.esc(xv)) + '</div>');
          lines.push('<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + (q.color || '#0b6e99') + ';margin-right:5px"></span>' +
            U.esc(q.seriesName || '') + ' <b>' + U.fmt(v, digits) + '</b></div>');
        });
        return lines.join('') || '';
      }
    };

    return {
      animation: false,
      backgroundColor: '#ffffff',
      grid: grid,
      legend: legend,
      tooltip: tooltip,
      xAxis: [xAxisMain, xAxisTop],
      yAxis: [yAxisMain, yAxisRight],
      series: seriesOut,
      __ranges: { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax }
    };
  };

  WM.renderChart = function (el, option) {
    var inst = U.initChart(el);
    inst.setOption(option, true);
    return inst;
  };

  /* ---------------- 具体图表 ---------------- */

  /* ---- 调色板：多列同图时用 ---- */
  WM.palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

  /** 由测量列构造「测点序号 → 值」的序列（跳过缺测） */
  function seqPoints(values, startAt) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      if (!isFinite(values[i])) continue;
      out.push([(startAt || 0) + i + 1, values[i]]);
    }
    return out;
  }

  /**
   * 逐点 Lineplot：横轴 = 测点序号，纵轴 = 膜厚 —— 「沿坐标点分布」
   * cfg = {name, unit, digits, values, stat, showMean, showSigma, showFit}
   */
  WM.chartLineplot = function (el, cfg) {
    var digits = cfg.digits;
    var unit = cfg.unit ? ' (' + cfg.unit + ')' : '';
    var pts = seqPoints(cfg.values, 0);
    var series = [{
      type: 'line', name: cfg.name || '膜厚', data: pts,
      color: WM.chartColors.accent, symbolSize: 5, lineWidth: 1.5, z: 4
    }];

    var refs = [], band = null;
    if (cfg.showMean !== false && isFinite(cfg.stat.mean)) {
      refs.push({ value: cfg.stat.mean, label: 'Mean ' + U.fmt(cfg.stat.mean, digits), color: '#d64541' });
    }
    if (cfg.showSigma !== false && isFinite(cfg.stat.mean) && isFinite(cfg.stat.std)) {
      band = { from: cfg.stat.mean - cfg.stat.std, to: cfg.stat.mean + cfg.stat.std };
    }

    var fit = null;
    if (cfg.showFit) {
      fit = WM.linfit(pts.map(function (p) { return p[0]; }), pts.map(function (p) { return p[1]; }));
      if (isFinite(fit.b) && pts.length > 1) {
        var x0 = pts[0][0], x1 = pts[pts.length - 1][0];
        series.push({
          type: 'line', name: '趋势', data: [[x0, fit.a + fit.b * x0], [x1, fit.a + fit.b * x1]],
          color: WM.chartColors.fit, showSymbol: false, lineWidth: 1.6, dash: true, z: 5
        });
      }
    }

    var nPts = pts.length;
    var wpx = (el && el.clientWidth) || 360;
    var maxLabels = Math.max(4, Math.floor(wpx / 46));
    var labelStep = Math.max(1, Math.ceil(nPts / maxLabels));

    var opt = WM.buildOption({
      xType: 'value', xName: cfg.xName || 'Measurement Index', yName: (cfg.name || '膜厚') + unit,
      digits: digits, series: series, refs: refs, band: band, yPad: 0.10,
      showValues: cfg.showValues, labelStep: labelStep,
      grid: { left: 64, right: 26, top: 28, bottom: 46 },
      tooltip: function (p) {
        var q = Array.isArray(p) ? p[0] : p;
        if (!q || q.seriesName === '__ref__') return '';
        return '<div style="font-size:11px;color:#6b7785">测点 #' + U.fmt(q.value[0], 0) + '</div>' +
          '<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + q.color + ';margin-right:5px"></span>' +
          U.esc(q.seriesName) + ' <b>' + U.fmt(q.value[1], digits) + '</b>' + U.esc(unit) + '</div>';
      }
    });
    opt.__fit = fit;
    return WM.renderChart(el, opt);
  };

  /**
   * 多列合并 Lineplot：所有膜厚列画在同一张图上（共用一根 Y 轴）
   * cfg = {list:[{name, values}], digits, unit}
   */
  WM.chartMultiLine = function (el, cfg) {
    var digits = cfg.digits;
    var unit = cfg.unit ? ' (' + cfg.unit + ')' : '';
    var series = (cfg.list || []).map(function (s, i) {
      return {
        type: 'line', name: s.name, data: seqPoints(s.values, 0),
        color: WM.palette[i % WM.palette.length],
        showSymbol: false, lineWidth: 1.4, z: 3 + i
      };
    });
    var opt = WM.buildOption({
      xType: 'value', xName: 'Measurement Index', yName: '膜厚' + unit,
      digits: digits, series: series, yPad: 0.08, legendType: 'scroll',
      grid: { left: 64, right: 26, top: 36, bottom: 46 },
      tooltip: function (p) {
        var arr = Array.isArray(p) ? p : [p];
        var q0 = arr.find(function (q) { return q.seriesName !== '__ref__'; });
        var head = q0 ? '<div style="font-size:11px;color:#6b7785">测点 #' + U.fmt(q0.value[0], 0) + '</div>' : '';
        var rows = arr.filter(function (q) { return q.seriesName !== '__ref__'; }).map(function (q) {
          return '<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + q.color + ';margin-right:5px"></span>' +
            U.esc(q.seriesName) + ' <b>' + U.fmt(q.value[1], digits) + '</b></div>';
        });
        return head + rows.join('');
      }
    });
    return WM.renderChart(el, opt);
  };

  /** 直方图 */
  WM.chartHist = function (el, cfg) {
    var digits = cfg.digits;
    var unit = cfg.unit ? ' (' + cfg.unit + ')' : '';
    var bins = WM.histogram(cfg.values, cfg.bins || 10);
    var series = [{ type: 'bar', name: '频数', data: bins.map(function (b) { return [b.mid, b.count]; }), color: WM.chartColors.accent, barWidth: '82%' }];
    var xRefs = [];   // 均值/中位数数值改在卡片副标题展示，图内不再画竖线

    var bw = bins.length ? (bins[0].x1 - bins[0].x0) : 1;
    var hpx = (el && el.clientWidth) || 380;
    var histStep = Math.max(1, Math.ceil(bins.length / Math.max(4, Math.floor(hpx / 34))));
    var opt = WM.buildOption({
      xType: 'value', xName: (cfg.name || '') + unit, yName: '频数',
      digits: digits, yDigits: 0, series: series, xRefs: xRefs, yZero: true, yPad: 0.14,
      showValues: cfg.showValues, labelStep: histStep,
      xMin: bins.length ? bins[0].x0 - bw * 0.12 : undefined,
      xMax: bins.length ? bins[bins.length - 1].x1 + bw * 0.12 : undefined,
      grid: { left: 58, bottom: 46 },
      tooltip: function (p) {
        var q = Array.isArray(p) ? p[0] : p;
        if (!q || q.seriesName === '__ref__') return '';
        var b = bins[q.dataIndex];
        if (!b) return '';
        return '<div style="font-size:11px;color:#6b7785">' + U.fmt(b.x0, digits) + ' – ' + U.fmt(b.x1, digits) + '</div>' +
          '<div>频数 <b>' + b.count + '</b></div>';
      }
    });
    opt.xAxis[0].axisPointer = { show: false };
    opt.xAxis[1].min = opt.xAxis[0].min;
    opt.xAxis[1].max = opt.xAxis[0].max;
    return WM.renderChart(el, opt);
  };

  /**
   * 按半径聚类：把测点分成「同心环」若干组（相邻半径差 > 容差就开新组）
   * 返回 [{r, n, min, q1, med, q3, max, mean, std}]
   */
  WM.clusterByRadius = function (radii, values) {
    var idx = [], i;
    for (i = 0; i < radii.length; i++) if (isFinite(radii[i]) && isFinite(values[i])) idx.push(i);
    if (!idx.length) return [];
    idx.sort(function (a, b) { return radii[a] - radii[b]; });
    var rmax = radii[idx[idx.length - 1]];
    var tol = Math.max(6, rmax * 0.05);           // 环间距容差：≥6mm 或最大半径的 5%

    var groups = [], cur = null;
    idx.forEach(function (k) {
      var r = radii[k];
      if (!cur || r - cur.maxR > tol) {
        cur = { vals: [], rSum: 0, n: 0, minR: r, maxR: r };
        groups.push(cur);
      }
      cur.vals.push(values[k]);
      cur.rSum += r;
      cur.n++;
      cur.maxR = r;
    });

    return groups.map(function (g) {
      var st = WM.stat(g.vals);
      return {
        r: g.rSum / g.n, n: g.n, rMin: g.minR, rMax: g.maxR,
        min: st.min, q1: st.p25, med: st.median, q3: st.p75, max: st.max,
        mean: st.mean, std: st.std
      };
    });
  };

  /** 按半径分组的箱线图 */
  WM.chartBoxByRadius = function (el, cfg) {
    var digits = cfg.digits;
    var unit = cfg.unit ? ' (' + cfg.unit + ')' : '';
    var groups = WM.clusterByRadius(cfg.radii, cfg.values);
    var cats = groups.map(function (g) { return 'R ' + U.fmt(g.r, 0); });

    var opt = WM.buildOption({
      xType: 'category', categories: cats,
      xName: 'Radius (mm)', yName: 'Thickness' + unit,
      digits: digits, yPad: 0.14, showValues: false,
      legend: false,
      grid: { left: 64, right: 26, top: 20, bottom: 44 },
      series: [{
        type: 'boxplot',
        name: '环统计',
        data: groups.map(function (g) { return [g.min, g.q1, g.med, g.q3, g.max]; }),
        color: WM.chartColors.accent
      }],
      tooltip: function (p) {
        var q = Array.isArray(p) ? p[0] : p;
        if (!q) return '';
        var g = groups[q.dataIndex];
        if (!g) return '';
        return '<div style="font-size:11px;color:#6b7785">半径 ' + U.fmt(g.rMin, 1) + '–' + U.fmt(g.rMax, 1) + ' mm · ' + g.n + ' 点</div>' +
          '<div>Max <b>' + U.fmt(g.max, digits) + '</b> · Q3 <b>' + U.fmt(g.q3, digits) + '</b></div>' +
          '<div>Median <b>' + U.fmt(g.med, digits) + '</b></div>' +
          '<div>Q1 <b>' + U.fmt(g.q1, digits) + '</b> · Min <b>' + U.fmt(g.min, digits) + '</b></div>';
      }
    });
    var o = WM.renderChart(el, opt);
    o.__groups = groups;
    return o;
  };

  /** 统计柱状图（按数值列对比） */
  WM.chartBar = function (el, cfg) {
    var digits = cfg.digits;
    var series = [{ type: 'bar', name: cfg.seriesName || cfg.yName, data: cfg.values, color: cfg.color || WM.chartColors.accent }];
    var opt = WM.buildOption({
      xType: 'category', categories: cfg.categories,
      xName: cfg.xName || '', yName: cfg.yName, digits: digits,
      series: series, yZero: false, yPad: 0.18, showValues: cfg.showValues,
      grid: { left: 62, right: 26, top: 18, bottom: 42 },
      legend: false,
      tooltip: function (p) {
        var q = Array.isArray(p) ? p[0] : p;
        if (!q) return '';
        return '<div style="font-size:11px;color:#6b7785">' + U.esc(q.name) + '</div><div>' +
          U.esc(cfg.yName) + ' <b>' + U.fmt(q.value, digits) + '</b></div>';
      }
    });
    return WM.renderChart(el, opt);
  };
})(window);
