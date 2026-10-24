/* ===========================================================
   export.js —— 导出：PNG（单图 / 全量拼版）、CSV（统计 / 原始数据）
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  var U = WM.util;

  function downloadDataURL(dataURL, filename) {
    var a = document.createElement('a');
    a.href = dataURL; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 100);
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片解码失败')); };
      img.src = src;
    });
  }

  /** 卡片 → dataURL（统一走 canvas / ECharts） */
  function cardToURL(card) {
    try {
      if (typeof card.composite === 'function') {
        var url = card.composite();
        if (url) return url;
      }
      if (card.kind === 'chart' && card.ref && card.ref.getDataURL) {
        return card.ref.getDataURL({ pixelRatio: 2, backgroundColor: '#ffffff' });
      }
      if (card.kind === 'canvas' && card.ref && card.ref.toDataURL) {
        return card.ref.toDataURL('image/png');
      }
    } catch (e) { return null; }
    return null;
  }

  var GROUP_TITLES = { map: 'Wafer Map', profile: 'Map Profile', hist: 'Distribution', stats: 'Statistics' };
  var GROUP_COLS = { map: 5, profile: 2, hist: 3, stats: 2 };
  var GROUP_MAXW = { map: 900, profile: 1100, hist: 900, stats: 1100 };
  var GROUP_ORDER = ['map', 'profile', 'hist', 'stats'];

  /**
   * 按「列」布局导出：完全还原界面里的左右排布（如 左 WaferMap + 右侧上下两图）
   * layout = { cols:[0.42, 0.58] }；card.slot = { col, row }
   */
  function exportColumns(cards, layout, filename, title) {
    var W = 2400, PAD = 36, GAP = 18, HEAD = 54, TITLE_H = 26;
    var cols = layout.cols || [1];
    var usableW = W - PAD * 2 - GAP * (cols.length - 1);
    var need = cards.map(function (c) { return loadImage(cardToURL(c)); });

    return Promise.all(need).then(function (imgs) {
      var widths = [];
      var sum = cols.reduce(function (a, b) { return a + b; }, 0);
      cols.forEach(function (f) { widths.push(usableW * f / sum); });

      // 每列内按 row 堆叠，卡高 = 宽 × 原图宽高比
      var colHeights = cols.map(function () { return 0; });
      var place = [];
      cards.forEach(function (c, i) {
        var im = imgs[i];
        var col = (c.slot && c.slot.col) || 0;
        var row = (c.slot && c.slot.row) || 0;
        var w = Math.min(widths[col], im.width);       // 不放大
        var h = w * im.height / im.width;
        place.push({ card: c, img: im, col: col, row: row, w: w, h: h });
      });
      cols.forEach(function (_, ci) {
        var list = place.filter(function (p) { return p.col === ci; })
          .sort(function (a, b) { return a.row - b.row; });
        var hh = 0;
        list.forEach(function (p, k) { hh += p.h + TITLE_H + (k ? GAP : 0); });
        colHeights[ci] = hh;
      });

      var bodyH = Math.max.apply(null, colHeights);
      var H = HEAD + bodyH + PAD;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#1f2a35';
      ctx.font = '700 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(title || filename || 'WaferMap').replace(/\.png$/i, ''), PAD, 40);

      var xs = [];
      var cx0 = PAD;
      cols.forEach(function (_, ci) { xs.push(cx0); cx0 += widths[ci] + GAP; });

      cols.forEach(function (_, ci) {
        var list = place.filter(function (p) { return p.col === ci; })
          .sort(function (a, b) { return a.row - b.row; });
        var y = HEAD;
        list.forEach(function (p) {
          ctx.fillStyle = '#3c4753';
          ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
          var label = String(p.card.title || '');
          while (label.length > 4 && ctx.measureText(label).width > p.w - 4) label = label.slice(0, -2);
          if (label !== p.card.title) label += '…';
          ctx.fillText(label, xs[ci], y + 15);
          ctx.drawImage(p.img, xs[ci], y + TITLE_H, p.w, p.h);
          ctx.strokeStyle = '#e7ebf0';
          ctx.lineWidth = 1;
          ctx.strokeRect(xs[ci] + 0.5, y + TITLE_H + 0.5, p.w - 1, p.h - 1);
          y += p.h + TITLE_H + GAP;
        });
      });

      downloadDataURL(cv.toDataURL('image/png'), (filename || 'wafermap-all.png'));
    });
  }

  /**
   * 全量拼版：把当前视图所有卡片排成一张联系表 PNG
   * cards: [{title, group, kind, ref, layout?, slot?}]
   * title: 拼版标题（可选）
   */
  WM.exportComposite = function (cards, filename, title) {
    var usable = (cards || []).filter(function (c) { return cardToURL(c); });
    if (!usable.length) return Promise.reject(new Error('没有可导出的图'));

    // 视图自带列布局（如单晶圆：左地图 + 右上下两图）→ 按列还原
    if (usable.length && usable[0].layout && usable[0].layout.type === 'columns') {
      return exportColumns(usable, usable[0].layout, filename, title);
    }

    var W = 2400, PAD = 36, GAP = 18, HEAD_TITLE = 54, CARD_TITLE = 28, MAX_ROW_H = 1000;
    var groups = {};
    GROUP_ORDER.forEach(function (g) { groups[g] = []; });
    usable.forEach(function (c) {
      var g = c.group || 'map';
      (groups[g] = groups[g] || []).push(c);
    });

    return Promise.all(usable.map(function (c) { return loadImage(cardToURL(c)); })).then(function (imgs) {
      var map = new Map();
      usable.forEach(function (c, i) { map.set(c, imgs[i]); });

      // 布局：列数 = min(该组上限, 卡片数)；单元宽再受「图片原始宽度」限制（绝不上采样）
      var sections = [];
      GROUP_ORDER.forEach(function (g) {
        var list = groups[g] || [];
        if (!list.length) return;
        var cols = Math.min(GROUP_COLS[g] || 3, list.length);
        var avail = (W - PAD * 2 - GAP * (cols - 1)) / cols;
        var cellW = Math.min(avail, GROUP_MAXW[g] || 800);
        list.forEach(function (c) {
          var im = map.get(c);
          if (im.width < cellW) cellW = im.width;
        });
        var rowH = 0;
        list.forEach(function (c) {
          var im = map.get(c);
          var w = Math.min(cellW, im.width);
          var h = w * im.height / im.width;
          if (h > rowH) rowH = h;
        });
        rowH = Math.min(rowH, MAX_ROW_H);
        var rows = Math.ceil(list.length / cols);
        var rowW = cols * cellW + (cols - 1) * GAP;
        var x0 = PAD + Math.max(0, (W - 2 * PAD - rowW) / 2);
        sections.push({ g: g, list: list, cols: cols, cellW: cellW, rowH: rowH, rows: rows, x0: x0, h: 36 + rows * (rowH + CARD_TITLE + GAP) });
      });

      var H = HEAD_TITLE + sections.reduce(function (a, s) { return a + s.h; }, 0) + PAD;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#1f2a35';
      ctx.font = '700 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(title || filename || 'WaferMap').replace(/\.png$/i, ''), PAD, 40);

      var y = HEAD_TITLE;
      sections.forEach(function (s) {
        ctx.fillStyle = '#0b6e99';
        ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(GROUP_TITLES[s.g] || s.g, PAD, y + 18);
        ctx.strokeStyle = '#dfe4ea'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y + 28); ctx.lineTo(W - PAD, y + 28); ctx.stroke();
        y += 36;

        s.list.forEach(function (c, i) {
          var r = Math.floor(i / s.cols), col = i % s.cols;
          var cx = s.x0 + col * (s.cellW + GAP);
          var cy = y + r * (s.rowH + CARD_TITLE + GAP);

          // 标题（超宽截断加省略号）
          var label = String(c.title || '');
          ctx.fillStyle = '#3c4753';
          ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
          while (label.length > 4 && ctx.measureText(label).width > s.cellW - 4) label = label.slice(0, -2);
          if (label !== c.title) label += '…';
          ctx.fillText(label, cx, cy + 15);

          // 等比绘制（不拉伸、不放大）
          var im = map.get(c);
          var w = Math.min(s.cellW, im.width);
          var h = w * im.height / im.width;
          var ox = cx + (s.cellW - w) / 2;
          ctx.drawImage(im, ox, cy + CARD_TITLE, w, h);
          ctx.strokeStyle = '#e7ebf0';
          ctx.strokeRect(ox + 0.5, cy + CARD_TITLE + 0.5, w - 1, h - 1);
        });
        y += s.h;
      });

      downloadDataURL(cv.toDataURL('image/png'), (filename || 'wafermap-all.png'));
    });
  };

  /** 单卡片 PNG */
  WM.exportCard = function (card, filename) {
    var url = cardToURL(card);
    if (!url) throw new Error('该图暂不可导出');
    downloadDataURL(url, filename || ((card.title || 'chart') + '.png'));
  };

  /** 统计 CSV */
  WM.statsCSV = function (S) {
    var names = S.valueNames, rows = [];
    var head = ['列', 'N', 'Mean', 'Median', 'Std', 'Min', 'Max', 'Range', 'Nu%'];
    var hasSpec = isFinite(S.spec.lsl) || isFinite(S.spec.usl);
    if (hasSpec) head.push('LSL', 'USL', 'InSpec%');
    rows.push(head.join(','));
    var d = S.digits;
    names.forEach(function (nm, i) {
      var col = WM.extractColumn(S.points, i);
      var st = WM.stat(col.values);
      var line = [nm, st.n, U.fmt(st.mean, d), U.fmt(st.median, d), U.fmt(st.std, d),
        U.fmt(st.min, d), U.fmt(st.max, d), U.fmt(st.range, d), U.fmt(st.nu, d)];
      if (hasSpec) {
        line.push(isFinite(S.spec.lsl) ? U.fmt(S.spec.lsl, d) : '', isFinite(S.spec.usl) ? U.fmt(S.spec.usl, d) : '');
        line.push(U.fmt(WM.inSpec(col.values, S.spec).pct, 2));
      }
      rows.push(line.join(','));
    });
    // 参数脚注（以 # 开头，便于人工阅读时区分）
    rows.push('# Unit=' + (S.unit || '') + ', Std=样本标准差(n-1), Nu%=Std/|Mean|*100, Digits=' + d);
    return rows.join('\r\n');
  };

  /** 带坐标与半径的数据 CSV */
  WM.dataCSV = function (S) {
    var pts = S.points;
    var head = ['X', 'Y', 'R'].concat(S.valueNames);
    var lines = [head.join(',')];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var r = Math.sqrt(p.x * p.x + p.y * p.y);
      var row = [p.x, p.y, U.round(r, 4)];
      for (var c = 0; c < S.valueNames.length; c++) {
        row.push(isFinite(p.v[c]) ? U.round(p.v[c], 6) : '');
      }
      lines.push(row.join(','));
    }
    return lines.join('\r\n');
  };

  WM.downloadText = function (text, filename) {
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    WM.download(filename, blob);
  };
})(window);
