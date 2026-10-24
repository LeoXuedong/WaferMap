/* ===========================================================
   views.js —— 三个视图：单晶圆 / 全量网格 / 统计对比
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  var U = WM.util;

  var live = { charts: [], ros: [], cards: [] };

  function disposeAll() {
    live.charts.forEach(function (c) { try { c.dispose(); } catch (e) { } });
    live.ros.forEach(function (ro) { try { if (ro && ro.disconnect) ro.disconnect(); } catch (e) { } });
    live.charts = []; live.ros = []; live.cards = [];
    WM.currentCards = [];
  }
  WM.disposeView = disposeAll;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function cardHead(title, sub) {
    var head = el('div', 'card-head');
    var t = el('div', 'ctitle');
    t.appendChild(el('span', 'ct', U.esc(title)));
    if (sub) t.appendChild(el('span', 'csub', U.esc(sub)));
    head.appendChild(t);
    var tools = el('div', 'ctools');
    head.appendChild(tools);
    return { head: head, tools: tools, titleEl: t };
  }

  function pngBtn(card) {
    var b = el('button', 'mini', 'PNG');
    b.title = '导出该图 PNG（2× 分辨率）';
    b.addEventListener('click', function () {
      try { WM.exportCard(card, WM.baseName(card.title) + '-' + WM.timestamp() + '.png'); }
      catch (e) { WM.toast(e.message || '导出失败', 'err'); }
    });
    return b;
  }

  /* ---------------- 晶圆色阶工具 ---------------- */
  function colorCtx(S, values) {
    var dom = WM.colorDomain(S, values);
    var ramp = WM.makeRamp(S.scale.name, S.scale.reverse, S.scale.levels);
    return {
      domain: dom,
      colorFn: function (t) { return WM.rgbCss(ramp(t)); },
      ramp: ramp
    };
  }

  /* ---------------- 统计条 ---------------- */
  var STAT_ORDER = ['mean', 'median', 'std', 'min', 'max', 'range', 'nu', 'n', 'inspec'];
  var STAT_LABEL = { mean: 'Mean', median: 'Median', std: 'Std', min: 'Min', max: 'Max', range: 'Range', nu: 'Nu%', n: 'N', inspec: 'In Spec' };

  /** 统计条目（界面统计条与 PNG 导出共用同一份计算） */
  function statEntries(st, S, col, opts) {
    opts = opts || {};
    var keys = opts.keys || S.stats.items;
    var hasSpec = isFinite(S.spec.lsl) || isFinite(S.spec.usl);
    var out = [];
    keys.forEach(function (k) {
      if (k === 'inspec' && !hasSpec) return;
      var val = '', unit = '';
      if (k === 'inspec') {
        val = U.fmt(WM.inSpec(col.values, S.spec).pct, Math.min(2, S.digits)) + '%';
      } else if (k === 'n') {
        val = String(st.n);
      } else {
        val = U.fmt(st[k], S.digits);
        unit = S.unit || '';
      }
      out.push({ k: k, label: STAT_LABEL[k], value: val, unit: unit });
    });
    return out;
  }

  /** 计算 legend 画布位置：右下角、竖直，且矩形不与圆相交（放不下则返回 null） */
  function legendBoxFor(g, hasText, textW) {
    var W = hasText ? Math.min(64, 9 + 4 + Math.max(16, textW || 26) + 3) : 11;
    var H = hasText ? Math.min(g.h * 0.26, g.R * 0.82) : Math.min(g.h * 0.24, g.R * 0.7);
    var x = g.w - 8 - W;
    var R2 = g.R * g.R;
    var inside = function (xx, yy) { return (xx - g.cx) * (xx - g.cx) + (yy - g.cy) * (yy - g.cy) <= R2; };
    var y = g.h - 8 - H;
    if (inside(x, y)) {
      var hh = H;
      while (hh >= (hasText ? 56 : 40)) {
        var yy = g.h - 8 - hh;
        if (!inside(x, yy)) { H = hh; y = yy; break; }
        hh -= 6;
        H = hh; y = g.h - 8 - hh;
      }
      if (inside(x, y)) return null;
    }
    return { x: x, y: y, w: W, h: H };
  }

  /** 绘制竖直色阶 + 刻度（独立画布） */
  function drawLegendCanvas(lc, colorFn, domain, digits, textW) {
    var w = lc.clientWidth, h = lc.clientHeight;
    if (!w || !h) return;
    var dpr = 2;
    if (lc.width !== Math.round(w * dpr) || lc.height !== Math.round(h * dpr)) {
      lc.width = Math.round(w * dpr);
      lc.height = Math.round(h * dpr);
    }
    var c = lc.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    var barW = textW ? 9 : 8;
    var grad = c.createLinearGradient(0, h, 0, 0);
    for (var i = 0; i <= 10; i++) grad.addColorStop(i / 10, colorFn(i / 10));
    c.fillStyle = grad;
    c.fillRect(0, 0, barW, h);
    c.strokeStyle = 'rgba(20,30,45,0.28)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, barW - 1, h - 1);

    if (!textW) return;
    c.font = '9px "Segoe UI", system-ui, sans-serif';
    c.fillStyle = '#3f4a55';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    var tx = barW + 4;
    c.fillText(U.fmt(domain.max, digits), tx, 5);
    c.fillText(U.fmt((domain.min + domain.max) / 2, digits), tx, h / 2);
    c.fillText(U.fmt(domain.min, digits), tx, h - 5);
  }

  function statStrip(st, S, col, opts) {
    opts = opts || {};
    var wrap = el('div', 'stats-strip' + (opts.compact ? ' compact' : ''));
    statEntries(st, S, col, opts).forEach(function (e) {
      var cell = el('div', 'stat-cell');
      cell.setAttribute('data-stat', e.k);
      cell.innerHTML = '<span class="sl">' + e.label + '</span>' +
        '<span class="sv">' + e.value + (e.unit ? '<i class="u">' + U.esc(e.unit) + '</i>' : '') + '</span>';
      wrap.appendChild(cell);
    });
    return wrap;
  }

  /** 导出用：晶圆 canvas + 底部统计条 → 一张 PNG dataURL */
  function composeWaferStats(cv, entries, legendCv, legendBox) {
    if (!entries || !entries.length || !cv.width) return cv.toDataURL('image/png');
    var dpr = 2;
    var cw = cv.width, ch = cv.height;
    var barH = Math.round(58 * dpr);
    var out = document.createElement('canvas');
    out.width = cw; out.height = ch + barH;
    var c = out.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(cv, 0, 0);
    if (legendCv && legendBox && legendCv.width) {
      c.drawImage(legendCv, legendBox.x * dpr, legendBox.y * dpr,
        legendBox.w * dpr, legendBox.h * dpr);
    }

    c.fillStyle = '#fafbfc'; c.fillRect(0, ch, cw, barH);
    c.strokeStyle = '#e6ebf0'; c.lineWidth = Math.max(1, dpr * 0.5);
    c.beginPath(); c.moveTo(0, ch + 0.5); c.lineTo(cw, ch + 0.5); c.stroke();

    var n = entries.length;
    var cellW = cw / n;
    entries.forEach(function (e, i) {
      if (i > 0) {
        c.strokeStyle = '#eaeef3';
        c.lineWidth = Math.max(1, dpr * 0.5);
        c.beginPath();
        c.moveTo(Math.round(i * cellW) + 0.5, ch + 8 * dpr);
        c.lineTo(Math.round(i * cellW) + 0.5, ch + barH - 8 * dpr);
        c.stroke();
      }
      var x = i * cellW + 14 * dpr;
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillStyle = '#7c8794';
      c.font = '600 ' + Math.round(11 * dpr) + 'px "Segoe UI", system-ui, sans-serif';
      c.fillText(e.label, x, ch + 10 * dpr);
      c.fillStyle = '#1b2733';
      c.font = '600 ' + Math.round(16 * dpr) + 'px "Segoe UI", system-ui, sans-serif';
      c.fillText(e.value, x, ch + 27 * dpr);
      if (e.unit) {
        var tw = c.measureText(e.value).width;
        c.fillStyle = '#7c8794';
        c.font = Math.round(11 * dpr) + 'px "Segoe UI", system-ui, sans-serif';
        c.fillText(e.unit, x + tw + 3 * dpr, ch + 33 * dpr);
      }
    });
    return out.toDataURL('image/png');
  }

  /* ---------------- 晶圆卡片 ---------------- */
  function buildWaferCard(S, ci, opts) {
    opts = opts || {};
    var col = WM.extractColumn(S.points, ci);
    var st = WM.stat(col.values);
    var cc = colorCtx(S, col.values);

    var card = { title: opts.title || S.valueNames[ci] || ('列' + (ci + 1)), group: 'map', kind: 'canvas', ref: null };
    var root = el('div', 'card card-wafer');
    var head = cardHead(card.title, opts.sub || '');
    head.tools.appendChild(pngBtn(card));
    root.appendChild(head.head);

    var wrap = el('div', 'wafer-wrap');
    var cv = el('canvas', 'wafer-canvas');
    wrap.appendChild(cv);
    root.appendChild(wrap);

    var legendCv = null, legendBox = null;
    if (S.wafer.legend !== false) {
      legendCv = el('canvas', 'wafer-legend');
      wrap.appendChild(legendCv);
    }

    var inst = new WM.Wafer(cv);
    inst.set({
      xs: col.xs, ys: col.ys, values: col.values,
      colorFn: cc.colorFn, domain: cc.domain, mean: st.mean,
      spec: S.spec,
      markerSize: S.wafer.size * (opts.markerScale || 1),
      showSigns: S.wafer.signs, showLabels: S.wafer.labels !== false,
      showInterp: S.wafer.interp, interpPower: S.wafer.interpPower,
      showOutline: S.wafer.outline, showLegend: S.wafer.legend !== false, digits: S.digits,
      labelStep: opts.labelStep || (opts.compact ? Math.max(1, Math.ceil(col.values.length / 10)) : 1),
      waferRadius: S.waferRadius,
      interpRes: opts.interpRes || S.wafer.interpRes,
      interpSmooth: S.wafer.interpSmooth,
      interpMethod: S.wafer.interpMethod,
      showContour: S.wafer.contour !== false,
      contourLevels: S.wafer.contourLevels || 8,
    });
    card.ref = cv;
    cv.__wafer = inst;          // 便于调试/自动化测试读取几何

    var draw = function () {
      inst.draw();
      layoutLegend();
    };

    /** 独立 legend 画布：定位到晶圆画布右下角，且保证矩形不与圆相交 */
    function layoutLegend() {
      if (!legendCv) return;
      var g = inst.geom;
      if (!g) return;
      var hasText = g.w >= 340;
      var tw = 0;
      if (hasText) {
        var probe = document.createElement('canvas').getContext('2d');
        probe.font = '9px "Segoe UI", system-ui, sans-serif';
        tw = Math.max(
          probe.measureText(U.fmt(cc.domain.max, S.digits)).width,
          probe.measureText(U.fmt((cc.domain.min + cc.domain.max) / 2, S.digits)).width,
          probe.measureText(U.fmt(cc.domain.min, S.digits)).width
        );
      }
      var box = legendBoxFor(g, hasText, tw);
      if (!box) { legendCv.style.display = 'none'; legendBox = null; return; }
      legendBox = box;
      legendCv.style.display = 'block';
      legendCv.style.left = box.x + 'px';
      legendCv.style.top = box.y + 'px';
      legendCv.style.width = box.w + 'px';
      legendCv.style.height = box.h + 'px';
      drawLegendCanvas(legendCv, cc.colorFn, cc.domain, S.digits, hasText ? box.w : 0);
    }

    global.requestAnimationFrame(draw);
    live.ros.push(U.observeResize(wrap, draw));

    cv.addEventListener('mousemove', function (ev) {
      var r = cv.getBoundingClientRect();
      var i = inst.hit(ev.clientX - r.left, ev.clientY - r.top);
      if (i < 0) { WM.hideTip(); return; }
      var d = col.values[i] - st.mean;
      var html = '<div class="tip-h">' + U.esc(S.valueNames[ci] || '') + '</div>' +
        '<div class="tip-row"><span>值</span><b>' + U.fmt(col.values[i], S.digits) + '</b> ' + U.esc(S.unit || '') + '</div>' +
        '<div class="tip-row"><span>偏差</span><b>' + (d >= 0 ? '+' : '\u2212') + U.fmt(Math.abs(d), S.digits) + '</b></div>' +
        '<div class="tip-row"><span>X / Y</span><b>' + U.fmt(col.xs[i], 2) + ' / ' + U.fmt(col.ys[i], 2) + '</b></div>' +
        '<div class="tip-row"><span>半径</span><b>' + U.fmt(col.radii[i], 2) + ' mm</b></div>';
      WM.showTip(html, ev.clientX + 14, ev.clientY + 14);
    });
    cv.addEventListener('mouseleave', WM.hideTip);

    var entries = [];
    if (opts.stats !== false) {
      entries = statEntries(st, S, col, { keys: opts.statKeys });
      root.appendChild(statStrip(st, S, col, { compact: !!opts.compact, keys: opts.statKeys }));
      card.composite = function () { return composeWaferStats(cv, entries, legendCv, legendBox); };
    }

    return { root: root, card: card, inst: inst, stat: st, col: col };
  }

  /* ---------------- 图表卡片 ---------------- */
  function buildChartCard(S, cfg) {
    var card = { title: cfg.title, group: cfg.group || 'profile', kind: 'chart', ref: null };
    var root = el('div', 'card card-chart');
    var head = cardHead(cfg.title, cfg.sub || '');
    head.tools.appendChild(pngBtn(card));
    root.appendChild(head.head);
    var box = el('div', 'chart-box');
    root.appendChild(box);
    var init = function () {
      try {
        card.ref = cfg.build(box);
        live.charts.push(card.ref);
        live.ros.push(U.observeResize(box, function () { try { card.ref.resize(); } catch (e) { } }));
      } catch (e) {
        box.innerHTML = '<div class="chart-err">图表渲染失败：' + U.esc(e.message) + '</div>';
      }
    };
    return { root: root, card: card, init: init };
  }

  /* ---------------- 单晶圆视图 ---------------- */
  function renderSingle(S, host, subbar) {
    var ci = S.active;
    var col = WM.extractColumn(S.points, ci);
    var st = WM.stat(col.values);
    var name = S.valueNames[ci] || ('列' + (ci + 1));
    var cc = colorCtx(S, col.values);
    var rmax = 0;
    for (var i = 0; i < col.radii.length; i++) if (col.radii[i] > rmax) rmax = col.radii[i];

    /* 子工具条：数值列切换 */
    var chips = el('div', 'chips-row');
    S.valueNames.forEach(function (nm, i) {
      var b = el('button', 'chip' + (i === ci ? ' active' : ''), U.esc(nm));
      b.setAttribute('data-col', String(i));
      b.addEventListener('click', function () { WM.setActive(i); });
      chips.appendChild(b);
    });
    subbar.appendChild(chips);
    subbar.appendChild(el('div', 'subbar-spacer'));
    subbar.appendChild(el('div', 'subbar-note',
      S.points.length + ' 点 · 半径 ' + U.fmt(rmax, 1) + ' mm · ' + S.valueNames.length + ' 个膜厚列'));

    var single = el('div', 'single');

    /* 左：晶圆图 + 统计 */
    var wc = buildWaferCard(S, ci, {
      title: 'WaferMap · ' + name,
      sub: '范围 ' + U.fmt(cc.domain.min, S.digits) + ' – ' + U.fmt(cc.domain.max, S.digits) +
        (S.unit ? ' ' + S.unit : ''),
      stats: true
    });
    single.appendChild(wc.root);

    /* 右：沿测点分布的 Lineplot（直方图已按需求移出单晶圆视图） */
    var right = el('div', 'stack2');
    var fit = WM.linfit(col.values.map(function (v, k) { return k + 1; }), col.values);

    var lp = buildChartCard(S, {
      title: 'Lineplot', group: 'profile',
      sub: S.points.length + ' 点 · Mean ' + U.fmt(st.mean, S.digits) +
        (S.unit ? ' ' + S.unit : '') + ' · ±1σ ' + U.fmt(st.std, S.digits) +
        (S.chart.showFit && isFinite(fit.b) ? ' · 趋势 ' + U.fmt(fit.b, Math.min(4, S.digits + 2)) + '/点' : ''),
      build: function (box) {
        return WM.chartLineplot(box, {
          name: name, unit: S.unit, digits: S.digits, stat: st,
          values: col.values,
          showMean: S.chart.showMean, showSigma: S.chart.showSigma,
          showFit: S.chart.showFit, showValues: S.chart.showValues
        });
      }
    });
    right.appendChild(lp.root);

    var bx = buildChartCard(S, {
      title: 'Boxplot · 按半径分环', group: 'profile',
      sub: (function () {
        var g = WM.clusterByRadius(col.radii, col.values);
        return g.length + ' 个半径环 · ' + g.map(function (x) { return x.n; }).join(' / ') + ' 点';
      })(),
      build: function (box) {
        return WM.chartBoxByRadius(box, {
          name: name, unit: S.unit, digits: S.digits,
          radii: col.radii, values: col.values
        });
      }
    });
    right.appendChild(bx.root);

    single.appendChild(right);
    host.appendChild(single);

    global.requestAnimationFrame(function () { lp.init(); bx.init(); });

    // 导出拼版：还原界面左右布局（左 WaferMap，右侧上下 Lineplot / Boxplot）
    var LAY = { type: 'columns', cols: [0.42, 0.58] };
    wc.card.layout = LAY; wc.card.slot = { col: 0, row: 0 };
    lp.card.layout = LAY; lp.card.slot = { col: 1, row: 0 };
    bx.card.layout = LAY; bx.card.slot = { col: 1, row: 1 };

    live.cards.push(wc.card, lp.card, bx.card);
  }

  /* ---------------- 全量网格视图 ---------------- */
  function renderGallery(S, host, subbar) {
    var mode = S.galleryMode || 'all';
    var merged = !!S.chart.profileMerge;
    var tab = (S.galleryTab === 'line') ? 'line' : 'map';

    /* TAB：WaferMap / LineProfile */
    var segTab = el('div', 'seg seg-tab');
    [['map', 'WaferMap'], ['line', 'LineProfile']].forEach(function (o) {
      var b = el('button', 'seg-btn' + (tab === o[0] ? ' active' : ''), o[1]);
      b.setAttribute('data-tab', o[0]);
      b.addEventListener('click', function () { WM.setGalleryTab(o[0]); });
      segTab.appendChild(b);
    });
    subbar.appendChild(segTab);

    /* LineProfile 页内：合并一张 / 分别显示 */
    if (tab === 'line' && mode !== 'hist') {
      var seg2 = el('div', 'seg');
      [['true', '合并一张'], ['false', '分别显示']].forEach(function (o) {
        var b = el('button', 'seg-btn' + ((String(merged) === o[0]) ? ' active' : ''), o[1]);
        b.setAttribute('data-merge', o[0]);
        b.addEventListener('click', function () { WM.setProfileMerge(o[0] === 'true'); });
        seg2.appendChild(b);
      });
      subbar.appendChild(seg2);
    }

    subbar.appendChild(el('div', 'subbar-spacer'));
    subbar.appendChild(el('div', 'subbar-note',
      S.valueNames.length + ' 个膜厚列 · 逐列独立色阶' + (S.scale.domain === 'global' ? '（全局范围）' : '')));

    var pending = [];
    var root = el('div', 'gallery-root');

    if (mode !== 'hist' && tab === 'map') {
      var secMap = el('div', 'gsec');
      secMap.appendChild(el('div', 'gsec-title', 'Wafer Map <span class="gsec-note">每列一张，色阶随设置</span>'));
      var gMap = el('div', 'grid grid-map');
      gMap.style.setProperty('--cols', String(Math.min(5, S.valueNames.length)));
      S.valueNames.forEach(function (nm, i) {
        var st = WM.stat(WM.extractColumn(S.points, i).values);
        var c = buildWaferCard(S, i, {
          title: nm, sub: 'Mean ' + U.fmt(st.mean, S.digits) + ' · Nu% ' + U.fmt(st.nu, S.digits),
          compact: true, markerScale: 0.82,
          interpRes: Math.max(90, Math.round(S.wafer.interpRes * 0.6)),
          statKeys: ['mean', 'std', 'nu']
        });
        c.root.classList.add('gcard');
        c.root.addEventListener('click', function (ev) {
          if (ev.target.closest('button')) return;
          WM.setActive(i); WM.setView('single');
        });
        gMap.appendChild(c.root);
        live.cards.push(c.card);
      });
      secMap.appendChild(gMap);
      root.appendChild(secMap);
    }

    if (mode !== 'hist' && tab === 'line') {
      var secP = el('div', 'gsec');
      secP.appendChild(el('div', 'gsec-title', 'Lineplot <span class="gsec-note">沿测点分布的膜厚（横轴 = 测点序号）' +
        (merged ? ' · 全部列合并一张' : ' · 每列一张') + '</span>'));

      if (merged) {
        var gM = el('div', 'grid grid-merged');
        var list = S.valueNames.map(function (nm, i) {
          return { name: nm, values: WM.extractColumn(S.points, i).values };
        });
        var cM = buildChartCard(S, {
          title: '逐点 Lineplot · 全部 ' + S.valueNames.length + ' 列', group: 'profile',
          sub: '测点序号 vs 膜厚 · 共用 Y 轴',
          build: function (box) {
            return WM.chartMultiLine(box, { list: list, digits: S.digits, unit: S.unit });
          }
        });
        gM.appendChild(cM.root);
        secP.appendChild(gM);
        pending.push(cM);
        live.cards.push(cM.card);
      } else {
        var gP = el('div', 'grid grid-profile');
        gP.style.setProperty('--cols', String(Math.min(2, S.valueNames.length)));
        S.valueNames.forEach(function (nm, i) {
          var col = WM.extractColumn(S.points, i);
          var st = WM.stat(col.values);
          var c = buildChartCard(S, {
            title: 'Lineplot · ' + nm, group: 'profile',
            sub: 'Nu% ' + U.fmt(st.nu, S.digits),
            build: function (box) {
              return WM.chartLineplot(box, {
                name: nm, unit: S.unit, digits: S.digits, stat: st,
                values: col.values,
                showMean: S.chart.showMean, showSigma: S.chart.showSigma,
                showFit: false, showValues: S.chart.showValues
              });
            }
          });
          gP.appendChild(c.root);
          pending.push(c);
          live.cards.push(c.card);
        });
        secP.appendChild(gP);
      }
      root.appendChild(secP);
    }

    if (mode === 'hist') {
      var secH = el('div', 'gsec');
      secH.appendChild(el('div', 'gsec-title', 'Distribution <span class="gsec-note">箱数 ' + S.chart.bins + '</span>'));
      var gH = el('div', 'grid grid-hist');
      gH.style.setProperty('--cols', '3');
      S.valueNames.forEach(function (nm, i) {
        var col = WM.extractColumn(S.points, i);
        var st = WM.stat(col.values);
        var c = buildChartCard(S, {
          title: '直方图 · ' + nm, group: 'hist', sub: 'Std ' + U.fmt(st.std, S.digits),
          build: function (box) {
            return WM.chartHist(box, { name: nm, unit: S.unit, digits: S.digits, stat: st, values: col.values, bins: S.chart.bins, showValues: S.chart.showValues });
          }
        });
        gH.appendChild(c.root);
        pending.push(c);
        live.cards.push(c.card);
      });
      secH.appendChild(gH);
      root.appendChild(secH);
    }

    host.appendChild(root);
    global.requestAnimationFrame(function () { pending.forEach(function (c) { c.init(); }); });
  }

  /* ---------------- 统计对比视图 ---------------- */
  function renderStats(S, host, subbar) {
    var hasSpec = isFinite(S.spec.lsl) || isFinite(S.spec.usl);
    subbar.appendChild(el('div', 'subbar-note', '全部膜厚列统计（Std 为样本标准差 n−1，Nu% = Std/|Mean|×100）'));
    subbar.appendChild(el('div', 'subbar-spacer'));

    var bStats = el('button', 'mini wide', '导出统计 CSV');
    bStats.addEventListener('click', function () {
      WM.downloadText(WM.statsCSV(S), WM.baseName(S.srcName) + '-stats-' + WM.timestamp() + '.csv');
    });
    var bData = el('button', 'mini wide', '导出数据 CSV');
    bData.addEventListener('click', function () {
      WM.downloadText(WM.dataCSV(S), WM.baseName(S.srcName) + '-data-' + WM.timestamp() + '.csv');
    });
    subbar.appendChild(bStats);
    subbar.appendChild(bData);

    var rows = S.valueNames.map(function (nm, i) {
      var col = WM.extractColumn(S.points, i);
      var st = WM.stat(col.values);
      return { nm: nm, st: st, ins: WM.inSpec(col.values, S.spec) };
    });

    var bestNu = rows.reduce(function (a, r) {
      return (!a || (isFinite(r.st.nu) && r.st.nu < a.st.nu)) ? r : a;
    }, null);

    var d = S.digits;
    var html = '<table class="stats-table"><thead><tr>' +
      '<th class="l">列</th><th>N</th><th>Mean</th><th>Median</th><th>Std</th>' +
      '<th>Min</th><th>Max</th><th>Range</th><th>Nu%</th>' +
      (hasSpec ? '<th>In Spec%</th>' : '') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      html += '<tr data-col="' + i + '"><td class="l">' + U.esc(r.nm) + '</td>' +
        '<td>' + r.st.n + '</td>' +
        '<td>' + U.fmt(r.st.mean, d) + '</td>' +
        '<td>' + U.fmt(r.st.median, d) + '</td>' +
        '<td>' + U.fmt(r.st.std, d) + '</td>' +
        '<td>' + U.fmt(r.st.min, d) + '</td>' +
        '<td>' + U.fmt(r.st.max, d) + '</td>' +
        '<td>' + U.fmt(r.st.range, d) + '</td>' +
        '<td class="' + (bestNu && r === bestNu ? 'best' : '') + '">' + U.fmt(r.st.nu, d) + '</td>' +
        (hasSpec ? '<td>' + U.fmt(r.ins.pct, 2) + '</td>' : '') +
        '</tr>';
    });
    html += '</tbody></table>';

    var tableCard = el('div', 'card card-table');
    var head = cardHead('统计汇总', S.valueNames.length + ' 个膜厚列' + (hasSpec ? ' · 含规格判定' : ''));
    var cardT = { title: '统计汇总', group: 'stats', kind: 'chart', ref: null };
    tableCard.appendChild(head.head);
    var body = el('div', 'table-wrap', html);
    tableCard.appendChild(body);
    body.addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-col]');
      if (!tr) return;
      WM.setActive(Number(tr.getAttribute('data-col')));
      WM.setView('single');
    });

    host.appendChild(tableCard);

    var two = el('div', 'two-charts');
    var cats = S.valueNames;
    var means = rows.map(function (r) { return r.st.mean; });
    var nus = rows.map(function (r) { return isFinite(r.st.nu) ? +r.st.nu.toFixed(6) : null; });

    var cMean = buildChartCard(S, {
      title: 'Mean 对比', group: 'stats', sub: '单位 ' + (S.unit || '—'),
      build: function (box) {
        return WM.chartBar(box, { categories: cats, values: means, yName: 'Mean', digits: S.digits, xName: '', color: '#0b6e99', showValues: S.chart.showValues });
      }
    });
    var cNu = buildChartCard(S, {
      title: 'Nu% 对比', group: 'stats', sub: '越小越均匀',
      build: function (box) {
        return WM.chartBar(box, { categories: cats, values: nus, yName: 'Nu%', digits: S.digits, xName: '', color: '#0f9d8f', showValues: S.chart.showValues });
      }
    });
    two.appendChild(cMean.root);
    two.appendChild(cNu.root);
    host.appendChild(two);

    var LAY2 = { type: 'columns', cols: [0.5, 0.5] };
    cMean.card.layout = LAY2; cMean.card.slot = { col: 0, row: 0 };
    cNu.card.layout = LAY2; cNu.card.slot = { col: 1, row: 0 };

    live.cards.push(cMean.card, cNu.card);
    global.requestAnimationFrame(function () { cMean.init(); cNu.init(); });
  }

  /* ---------------- 入口 ---------------- */
  WM.renderView = function (S) {
    disposeAll();
    var host = document.getElementById('viewRoot');
    var subbar = document.getElementById('subbar');
    host.innerHTML = ''; subbar.innerHTML = '';
    host.className = 'view-' + S.view;

    if (!S.points || !S.points.length) {
      host.innerHTML = '<div class="empty"><div class="empty-t">未载入数据</div>' +
        '<div class="empty-s">点击顶部「导入数据」选择 CSV / Excel 文件（.xlsx · .xlsm · .xls）</div></div>';
      return;
    }
    if (S.view === 'single') renderSingle(S, host, subbar);
    else if (S.view === 'gallery') renderGallery(S, host, subbar);
    else renderStats(S, host, subbar);

    WM.currentCards = live.cards.slice();
    WM.renderCounter = (WM.renderCounter || 0) + 1;
    WM.lastRenderAt = Date.now();
  };

  WM.views = { buildWaferCard: buildWaferCard, statStrip: statStrip };
})(window);
