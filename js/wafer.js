/* ===========================================================
   wafer.js —— 晶圆图渲染器（自绘 canvas，零依赖）
   支持：色阶填色 / 标记形状 / 插值面(IDW) / 均值正负号 / 数值标签
        / 规格越界圈 / 悬停命中检测 / 高分辨率导出
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  var U = WM.util;

  function Wafer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = {};
    this.geom = null;     // {cx, cy, R, scale, px:[{x,y}], r:[]}
    this._cellSize = 0;
  }

  Wafer.prototype.set = function (opts) {
    if (opts && ('values' in opts || 'xs' in opts || 'ys' in opts)) this._tpsCache = null;
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) this.opts[k] = opts[k];
    return this;
  };

  Wafer.prototype._geom = function (w, h) {
    var o = this.opts;
    // 圆尽量大；开了数值标签时再让出一点边距，让贴边测点的数字能完整显示在圆外
    var pad = 5;
    var labPad = (o.showLabels === false) ? 0 : (w < 340 ? 10 : 24);
    var R = Math.min(w, h) / 2 - pad - labPad;
    var cx = w / 2, cy = h / 2;
    var legW = 0, legH = 0;
    var waferR = o.waferRadius || this._autoRadius();
    var scale = R / waferR;
    return { cx: cx, cy: cy, R: R, scale: scale, waferR: waferR, w: w, h: h, legW: legW, legH: legH };
  };

  Wafer.prototype._autoRadius = function () {
    var xs = this.opts.xs || [], ys = this.opts.ys || [];
    var m = 0;
    for (var i = 0; i < xs.length; i++) {
      var r = Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i]);
      if (isFinite(r) && r > m) m = r;
    }
    return m > 0 ? m : 150;
  };

  /** 主绘制。cssW/cssH 可选（离屏导出时显式给尺寸） */
  Wafer.prototype.draw = function (cssW, cssH, dprOverride) {
    var o = this.opts, cv = this.canvas, ctx = this.ctx;
    var w = cssW || cv.clientWidth;
    var h = cssH || cv.clientHeight;
    if (!w || !h) return false;
    var dpr = dprOverride || Math.max(2, Math.min(global.devicePixelRatio || 1, 2)); // 固定 ≥2×，导出更清晰
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = o.bg || '#ffffff';
    ctx.fillRect(0, 0, w, h);

    var g = this._geom(w, h);
    this.geom = g;
    var xs = o.xs || [], ys = o.ys || [], vs = o.values || [];
    var colorFn = o.colorFn || function () { return 'rgb(120,120,120)'; };
    var domain = o.domain || { min: 0, max: 1 };

    // 屏幕坐标预计算
    var px = [], py = [], t = [];
    for (var i = 0; i < xs.length; i++) {
      px.push(g.cx + xs[i] * g.scale);
      py.push(g.cy - ys[i] * g.scale);
      t.push(WM.toUnit(vs[i], domain));
    }
    this.geom.px = px; this.geom.py = py;

    var disc = new Path2D();
    disc.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);

    // 晶圆底
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
    ctx.fillStyle = o.discFill || '#fafbfc';
    ctx.fill();
    ctx.restore();

    // 插值面
    if (o.showInterp && xs.length >= 3) {
      this._drawSurface(ctx, g, px, py, vs, colorFn, domain);
    }

    // 测点标注：不画圆形标记，只画 +/− 符号（可叠加数值标签）
    var size = o.markerSize || 12;
    var mean = o.mean;
    var specOn = !!(o.spec && (isFinite(o.spec.lsl) || isFinite(o.spec.usl)));
    var placedRects = [];   // 已放置的数值标签，用于避让
    ctx.save();
    for (var k = 0; k < xs.length; k++) {
      var v = vs[k];
      if (!isFinite(v)) continue;
      var x = px[k], y = py[k];
      var rgb = colorFn(t[k]).match(/\d+/g).map(Number);
      var dark = U.luminance(rgb) > 0.15;   // 亮底用深色字、只有很暗的底才用白字

      var out = false;
      if (specOn) {
        if (isFinite(o.spec.lsl) && v < o.spec.lsl) out = true;
        if (isFinite(o.spec.usl) && v > o.spec.usl) out = true;
      }

      if (o.showSigns && isFinite(mean)) {
        var sign = v > mean ? '+' : (v < mean ? '\u2212' : '=');
        var fs = Math.max(9, Math.round(size));
        ctx.font = '700 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = out ? '#d64541' : (dark ? '#101820' : '#ffffff');
        ctx.fillText(sign, x, y + 0.5);
      } else {
        // 关掉符号时用 3px 小点标示位置（越界点标红）
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = out ? '#d64541' : (dark ? '#26313c' : '#ffffff');
        ctx.fill();
      }

      // 数值标签：优先放在点的「外侧」（允许落在圆外，与参考软件一致），
      // 出画布就翻到内侧，再不行贴边钳制 —— 任何位置都完整可读
      var lstep = Math.max(1, o.labelStep || 1);
      if (o.showLabels && (lstep <= 1 || k % lstep === 0)) {
        var txt = U.fmt(v, o.digits);
        var fsL = Math.max(11, Math.round(size * 1.0));
        ctx.font = '600 ' + fsL + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        var ux = x - g.cx, uy = y - g.cy;
        var ud = Math.sqrt(ux * ux + uy * uy);
        if (ud < 0.5) { ux = 0; uy = -1; ud = 1; }
        ux /= ud; uy /= ud;

        var tw = ctx.measureText(txt).width;
        var th = fsL * 0.9;
        var hoff = size * 0.45 + 4;          // 水平间距（贴近参考图：数字紧挨符号）
        var voff = size * 0.62 + 4;          // 垂直间距
        var goRight = (x >= g.cx);           // 右半边优先向右排，左半边优先向左排
        // 候选顺序：左右主方向 → 左右反方向 → 上下 → 更远一圈 → 斜向兜底
        var cands = [];
        var rightFirst = goRight
          ? [{ x: x + hoff, y: y, a: 'left' }, { x: x - hoff, y: y, a: 'right' }]
          : [{ x: x - hoff, y: y, a: 'right' }, { x: x + hoff, y: y, a: 'left' }];
        cands = cands.concat(rightFirst);
        cands.push({ x: x, y: y - voff, a: 'center' });
        cands.push({ x: x, y: y + voff, a: 'center' });
        // 由近到远 3 档距离 × 8 方向，最大化可用位置（避免标签互相压住）
        var dists = [1.9, 2.8, 3.8];
        for (var di = 0; di < dists.length; di++) {
          var m = dists[di];
          cands.push({ x: x + ux * hoff * m, y: y + uy * hoff * m, a: 'center' });
          cands.push({ x: x - ux * hoff * m, y: y - uy * hoff * m, a: 'center' });
          cands.push({ x: x + hoff * m, y: y, a: 'left' });
          cands.push({ x: x - hoff * m, y: y, a: 'right' });
          cands.push({ x: x, y: y - voff * m, a: 'center' });
          cands.push({ x: x, y: y + voff * m, a: 'center' });
          cands.push({ x: x + hoff * m * 0.8, y: y - voff * m * 0.8, a: 'left' });
          cands.push({ x: x - hoff * m * 0.8, y: y + voff * m * 0.8, a: 'right' });
        }
        var placed = null;
        for (var ci = 0; ci < cands.length && !placed; ci++) {
          var px2 = cands[ci].x, py2 = cands[ci].y;
          var al = cands[ci].a || ((px2 > x + 0.5) ? 'left' : (px2 < x - 0.5 ? 'right' : 'center'));
          var left = al === 'left' ? px2 : (al === 'right' ? px2 - tw : px2 - tw / 2);
          var r0 = left, r1 = left + tw, t0 = py2 - th / 2, t1 = py2 + th / 2;
          if (r0 < 2 || r1 > g.w - 2 || t0 < 1 || t1 > g.h - 1) continue;
          var hit = false;
          for (var pi = 0; pi < placedRects.length; pi++) {
            var q = placedRects[pi];
            if (r0 < q.x1 + 1 && r1 > q.x0 - 1 && t0 < q.y1 + 1 && t1 > q.y0 - 1) { hit = true; break; }
          }
          if (!hit) placed = { x: px2, y: py2, align: al, x0: r0, x1: r1, y0: t0, y1: t1 };
        }
        if (!placed) {
          var nxp = cands[0].x, nyp = cands[0].y;
          var al2 = cands[0].a || ((nxp > x + 0.5) ? 'left' : (nxp < x - 0.5 ? 'right' : 'center'));
          var l2 = al2 === 'left' ? nxp : (al2 === 'right' ? nxp - tw : nxp - tw / 2);
          if (l2 < 2) { al2 = 'left'; nxp = 2; }
          else if (l2 + tw > g.w - 2) { al2 = 'right'; nxp = g.w - 2; }
          var fy = Math.max(th / 2 + 1, Math.min(g.h - th / 2 - 1, nyp));
          placed = {
            x: nxp, y: fy, align: al2,
            x0: al2 === 'left' ? nxp : (al2 === 'right' ? nxp - tw : nxp - tw / 2),
            x1: 0, y0: fy - th / 2, y1: fy + th / 2
          };
          placed.x1 = placed.x0 + tw;
        }
        placedRects.push({ x0: placed.x0, y0: placed.y0, x1: placed.x1, y1: placed.y1 });
        ctx.textAlign = placed.align;
        // 文字颜色按「标签实际落点」判断：落在圆外的白底上必须用深色字
        var ldx = placed.x - g.cx, ldy = placed.y - g.cy;
        var outside = (ldx * ldx + ldy * ldy) > (g.R - 3) * (g.R - 3);
        var fg = (outside || dark) ? '#101820' : '#ffffff';
        ctx.lineWidth = Math.max(2, fsL * 0.22);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = (outside || dark) ? 'rgba(255,255,255,0.85)' : 'rgba(20,28,38,0.55)';
        ctx.strokeText(txt, placed.x, placed.y);
        ctx.fillStyle = fg;
        ctx.fillText(txt, placed.x, placed.y);
      }
    }
    ctx.restore();

    this.labelCount = placedRects.length;
    this.lastLabels = placedRects.slice();

    // 晶圆外框（无缺口；用户要求去掉 notch 三角）
    if (o.showOutline !== false) {
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
      ctx.strokeStyle = o.outlineColor || '#aeb7c2';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 图例由独立画布绘制（见 views.js），此处不再在晶圆画布内画
    return true;
  };

  /**
   * 图例布局：优先「圆下方空白处靠右的横条」，其次「圆右侧空白处的竖条」，
   * 都没有空间就不画（绝不挤压晶圆）。
   */
  Wafer.prototype._legendLayout = function (g) {
    var bottomGap = g.h - (g.cy + g.R) - 8;     // 圆下方可用高度
    if (bottomGap >= 26) {
      var fs = g.w < 340 ? 9 : 10;
      var barH = 8;
      var need = barH + 4 + fs + 4;             // 条 + 刻度文字
      var barW = Math.min(g.R * 1.25, g.w - 60);
      return {
        mode: 'bottom', fs: fs, barH: barH, barW: barW,
        x: g.w - 14 - barW, y: g.cy + g.R + 8, fit: need <= bottomGap + 6
      };
    }
    var rightGap = g.w - (g.cx + g.R) - 8;
    if (rightGap >= 52) {
      var bh = Math.min(g.R * 1.0, g.h * 0.42);
      return { mode: 'right', fs: 10, barW: 9, barH: bh, x: g.w - 48, y: g.cy - bh / 2, fit: true };
    }
    return null;
  };

  /** 色阶图例：渐变条 + min / mid / max 刻度 */
  Wafer.prototype._drawLegend = function (ctx, g, colorFn, domain) {
    var o = this.opts;
    var L = this._legendLayout(g);
    if (!L) return;

    var digits = o.digits === undefined ? 2 : o.digits;
    var sMax = U.fmt(domain.max, digits);
    var sMid = U.fmt((domain.min + domain.max) / 2, digits);
    var sMin = U.fmt(domain.min, digits);

    if (L.mode === 'bottom') {
      var grad = ctx.createLinearGradient(L.x, 0, L.x + L.barW, 0);
      for (var i = 0; i <= 10; i++) grad.addColorStop(i / 10, colorFn(i / 10));
      ctx.fillStyle = grad;
      ctx.fillRect(L.x, L.y, L.barW, L.barH);
      ctx.strokeStyle = 'rgba(20,30,45,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.barW - 1, L.barH - 1);

      ctx.font = L.fs + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#4a5661';
      ctx.textBaseline = 'top';
      var ty = L.y + L.barH + 4;
      ctx.textAlign = 'left';
      ctx.fillText(sMin, L.x, ty);
      ctx.textAlign = 'center';
      ctx.fillText(sMid, L.x + L.barW / 2, ty);
      ctx.textAlign = 'right';
      ctx.fillText(sMax, L.x + L.barW, ty);
      return;
    }

    // 右侧竖条：顶端 = 最大值
    var vg = ctx.createLinearGradient(0, L.y + L.barH, 0, L.y);
    for (var j = 0; j <= 10; j++) vg.addColorStop(j / 10, colorFn(j / 10));
    ctx.fillStyle = vg;
    ctx.fillRect(L.x, L.y, L.barW, L.barH);
    ctx.strokeStyle = 'rgba(20,30,45,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.barW - 1, L.barH - 1);

    ctx.font = L.fs + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#4a5661';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(sMax, L.x + L.barW + 4, L.y + 1);
    ctx.fillText(sMid, L.x + L.barW + 4, L.y + L.barH / 2);
    ctx.fillText(sMin, L.x + L.barW + 4, L.y + L.barH - 1);
  };

  /**
   * 薄板样条（thin-plate spline）求解：f(x,y) = Σ w_i·r²ln r + a0 + a1·x + a2·y
   * 特点：**精确通过每个测点**且整体二阶连续 → 既平滑又保留局部极值（不会把边缘红环抹掉）
   * 点数 ≤ 300 时使用；超过则退回高斯核（O(n³) 求解成本）
   */
  function solveTPS(xs, ys, vs, scale) {
    var n = xs.length, m = n + 3;
    var P = new Array(n);
    for (var i = 0; i < n; i++) P[i] = [xs[i] * scale, ys[i] * scale];

    var A = new Array(m);
    for (i = 0; i < m; i++) A[i] = new Float64Array(m);
    var phi = function (r) { return r <= 1e-12 ? 0 : r * r * Math.log(r); };

    for (i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1];
        var v = phi(Math.sqrt(dx * dx + dy * dy));
        A[i][j] = v; A[j][i] = v;
      }
      A[i][i] = 1e-9;                          // 轻微正则化，改善条件数
      A[i][n] = 1; A[i][n + 1] = P[i][0]; A[i][n + 2] = P[i][1];
      A[n][i] = 1; A[n + 1][i] = P[i][0]; A[n + 2][i] = P[i][1];
    }

    var b = new Float64Array(m);
    for (i = 0; i < n; i++) b[i] = vs[i];

    for (var k = 0; k < m; k++) {
      var piv = k, mx = Math.abs(A[k][k]);
      for (var r2 = k + 1; r2 < m; r2++) {
        var av = Math.abs(A[r2][k]);
        if (av > mx) { mx = av; piv = r2; }
      }
      if (mx < 1e-14) continue;
      if (piv !== k) {
        var t = A[piv]; A[piv] = A[k]; A[k] = t;
        var tb = b[piv]; b[piv] = b[k]; b[k] = tb;
      }
      var d = A[k][k];
      for (var c = k; c < m; c++) A[k][c] /= d;
      b[k] /= d;
      for (var rr = 0; rr < m; rr++) {
        if (rr === k) continue;
        var f = A[rr][k];
        if (!f) continue;
        for (var cc = k; cc < m; cc++) A[rr][cc] -= f * A[k][cc];
        b[rr] -= f * b[k];
      }
    }

    var sol = b;
    return function (x, y) {
      var X = x * scale, Y = y * scale;
      var sum = sol[n] + sol[n + 1] * X + sol[n + 2] * Y;
      for (var i2 = 0; i2 < n; i2++) {
        var dx2 = X - P[i2][0], dy2 = Y - P[i2][1];
        var rr2 = dx2 * dx2 + dy2 * dy2;
        if (rr2 > 1e-18) sum += sol[i2] * rr2 * Math.log(Math.sqrt(rr2));
      }
      return sum;
    };
  }

  /* -------- 插值面（薄板样条 / 高斯核，低分辨率栅格 + 双线性放大） -------- */
  Wafer.prototype._drawSurface = function (ctx, g, px, py, vs, colorFn, domain) {
    var res = this.opts.interpRes || 200;   // 由设置面板传入
    var n = px.length;

    /* 高斯核尺度：按「点间平均间距」自适应，核宽 ≈ 1.25×平均间距 → 过渡连续、无牛眼 */
    var waferR = this.opts.waferRadius || this._autoRadius();
    var spacing = Math.sqrt(Math.PI * waferR * waferR / Math.max(1, n));
    var smooth = (this.opts.interpSmooth === undefined ? 0.55 : this.opts.interpSmooth);
    var sigma = Math.max(1e-6, spacing * smooth);
    var s2 = 2 * sigma * sigma;

    // 点数过多时抽样（保证 10^4 点级数据也能实时）
    var cap = 420, idxs = [];
    if (n <= cap) { for (var i = 0; i < n; i++) idxs.push(i); }
    else { var step = n / cap; for (var j = 0; j < cap; j++) idxs.push(Math.floor(j * step)); }

    /* 插值方法：tps 精确过点（默认）；gauss 高斯核平滑 */
    var method = this.opts.interpMethod || 'tps';
    var tps = null;
    if (method === 'tps' && n >= 3 && n <= 300) {
      if (!this._tpsCache || this._tpsCache.key !== this.opts.values.length) {
        this._tpsCache = { key: this.opts.values.length, f: solveTPS(this.opts.xs, this.opts.ys, vs, 1 / (waferR || 150)) };
      }
      tps = this._tpsCache.f;
    }
    var vmin = Infinity, vmax = -Infinity;
    for (var vi = 0; vi < vs.length; vi++) {
      if (isFinite(vs[vi])) { if (vs[vi] < vmin) vmin = vs[vi]; if (vs[vi] > vmax) vmax = vs[vi]; }
    }

    // 颜色查表（256 级，避免放大后出现色带）
    var LUT = new Array(256);
    for (var q = 0; q < 256; q++) LUT[q] = colorFn(q / 255).match(/\d+/g).map(Number);

    var grid = new Float32Array(res * res);
    var off = (this._off || (this._off = document.createElement('canvas')));
    off.width = res; off.height = res;
    var ictx = off.getContext('2d');
    var img = ictx.createImageData(res, res);
    var data = img.data;
    var R = this.opts.waferRadius || this._autoRadius();
    var step2 = (2 * R) / res;

    for (var gy = 0; gy < res; gy++) {
      var yy = R - (gy + 0.5) * step2;                 // 世界坐标（Y 向上）
      for (var gx = 0; gx < res; gx++) {
        var xx = -R + (gx + 0.5) * step2;
        var o2 = (gy * res + gx) * 4;
        // 圆外也照常插值（后续按圆裁剪），避免缩放时边缘出现半透明锯齿/白边

        var val;
        if (tps) {
          val = tps(xx, yy);
          // 样条可能在圆外过冲，钳制回数据范围
          if (!isFinite(val)) val = vmin;
          else if (val < vmin) val = vmin;
          else if (val > vmax) val = vmax;
        } else {
          var num = 0, den = 0, hitExact = false, bestD = Infinity, bestV = 0;
          for (var k = 0; k < idxs.length; k++) {
            var id = idxs[k];
            var dx = this.opts.xs[id] - xx;
            var dy = this.opts.ys[id] - yy;
            var d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; bestV = vs[id]; }
            if (d2 < 1e-9) { num = vs[id]; den = 1; hitExact = true; break; }
            var wt = Math.exp(-d2 / s2);          // 高斯核：平滑、无放射状牛眼
            num += wt * vs[id];
            den += wt;
          }
          val = hitExact ? num : (den > 1e-30 ? num / den : bestV);
        }
        if (!isFinite(val)) { data[o2 + 3] = 0; continue; }
        var tt = WM.toUnit(val, domain);
        grid[gy * res + gx] = val;
        var c = LUT[Math.max(0, Math.min(255, Math.round(tt * 255)))];
        data[o2] = c[0]; data[o2 + 1] = c[1]; data[o2 + 2] = c[2];
        data[o2 + 3] = 255;
      }
    }
    ictx.putImageData(img, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = this.opts.interpAlpha === undefined ? 0.9 : this.opts.interpAlpha;
    ctx.drawImage(off, g.cx - g.R, g.cy - g.R, 2 * g.R, 2 * g.R);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (this.opts.showContour) {
      this._drawContours(ctx, g, grid, res, domain, R);
    }
  };

  /** 等高线：在插值栅格上做 marching squares，等分为 N 条等值线 */
  Wafer.prototype._drawContours = function (ctx, g, grid, res, domain, R) {
    var levels = Math.max(2, this.opts.contourLevels || 8);
    var step2 = (2 * R) / res;
    var span = domain.max - domain.min;
    if (!(span > 0)) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.opts.contourColor || 'rgba(255,255,255,0.62)';
    ctx.beginPath();

    for (var li = 1; li <= levels; li++) {
      var lev = domain.min + span * li / (levels + 1);
      for (var gy = 0; gy < res - 1; gy++) {
        for (var gx = 0; gx < res - 1; gx++) {
          var v00 = grid[gy * res + gx];
          var v10 = grid[gy * res + gx + 1];
          var v01 = grid[(gy + 1) * res + gx];
          var v11 = grid[(gy + 1) * res + gx + 1];
          if (v00 === 0 && v10 === 0 && v01 === 0 && v11 === 0) continue;

          var b00 = v00 < lev, b10 = v10 < lev, b01 = v01 < lev, b11 = v11 < lev;
          if (b00 === b10 && b10 === b11 && b11 === b01) continue;

          // 栅格四角 → 屏幕坐标（栅格是世界坐标等距采样，y 轴向下）
          var x0 = -R + gx * step2, y0 = R - gy * step2;
          var sx0 = g.cx + x0 * g.scale, sy0 = g.cy - y0 * g.scale;
          var dxs = step2 * g.scale, dys = step2 * g.scale;

          var pts = [];
          if (b00 !== b10) pts.push([sx0 + dxs * (lev - v00) / (v10 - v00), sy0]);
          if (b10 !== b11) pts.push([sx0 + dxs, sy0 + dys * (lev - v10) / (v11 - v10)]);
          if (b01 !== b11) pts.push([sx0 + dxs * (lev - v01) / (v11 - v01), sy0 + dys]);
          if (b00 !== b01) pts.push([sx0, sy0 + dys * (lev - v00) / (v01 - v00)]);

          if (pts.length >= 2) {
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
          }
          if (pts.length === 4) {
            ctx.moveTo(pts[2][0], pts[2][1]);
            ctx.lineTo(pts[3][0], pts[3][1]);
          }
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  Wafer.prototype._shape = function (ctx, kind, x, y, r) {
    ctx.beginPath();
    if (kind === 'square') {
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
    } else if (kind === 'diamond') {
      ctx.moveTo(x, y - r * 1.18); ctx.lineTo(x + r * 1.18, y);
      ctx.lineTo(x, y + r * 1.18); ctx.lineTo(x - r * 1.18, y); ctx.closePath();
    } else if (kind === 'triangle') {
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.85);
      ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  };

  /** 命中检测：返回最近点的索引（容差 tol 像素），否则 -1 */
  Wafer.prototype.hit = function (mx, my) {
    var g = this.geom;
    if (!g || !g.px) return -1;
    var tol = Math.max(8, (this.opts.markerSize || 10) * 0.75);
    var best = -1, bd = tol * tol;
    for (var i = 0; i < g.px.length; i++) {
      var dx = g.px[i] - mx, dy = g.py[i] - my, d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = i; }
    }
    return best;
  };

  WM.Wafer = Wafer;
})(window);
