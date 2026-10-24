/* ===========================================================
   app.js —— 状态、面板、导入导出、快捷键
   =========================================================== */
(function (global) {
  'use strict';
  var WM = global.WM = global.WM || {};
  var U = WM.util;

  var S = WM.state = {
    dataset: null,
    workbook: null,
    sheetNames: [],
    sheet: '',
    points: [],
    valueNames: [],
    srcName: '',
    unit: '\u00c5',
    digits: 2,
    active: 0,
    view: 'single',
    galleryMode: 'all',
    galleryTab: 'map',
    waferRadius: 150,
    globalRange: null,
    scale: { name: 'jet', reverse: false, levels: 0, domain: 'auto', min: NaN, max: NaN },
    wafer: { size: 14, interp: true, interpRes: 220, interpSmooth: 0.7, interpMethod: 'tps', contour: true, contourLevels: 8, signs: true, labels: true, outline: false, legend: true },
    spec: { lsl: NaN, usl: NaN },
    stats: { items: ['mean', 'median', 'std', 'range', 'nu'] },
    chart: { showMean: true, showSigma: true, showFit: false, showValues: true, bins: 10, profileMerge: false }
  };

  var STAT_ORDER = ['mean', 'median', 'std', 'min', 'max', 'range', 'nu', 'inspec'];
  var STAT_LABEL = { mean: 'Mean', median: 'Median', std: 'Std', min: 'Min', max: 'Max', range: 'Range', nu: 'Nu%', n: 'N', inspec: 'In Spec' };

  var $ = function (id) { return document.getElementById(id); };
  var renderPending = false;

  /* ---------------- 提示 / 悬浮框 ---------------- */
  var toastBox = null;
  WM.toast = function (msg, type) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'toastBox'; document.body.appendChild(toastBox); }
    var d = document.createElement('div');
    d.className = 'toast' + (type ? ' ' + type : '');
    d.textContent = msg;
    toastBox.appendChild(d);
    setTimeout(function () { d.classList.add('out'); }, 2200);
    setTimeout(function () { d.remove(); }, 2700);
  };

  var tipEl = null;
  WM.showTip = function (html, x, y) {
    if (!tipEl) { tipEl = document.getElementById('tooltip'); }
    if (!tipEl) return;
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var vw = global.innerWidth, vh = global.innerHeight;
    if (x + w + 12 > vw) x = Math.max(4, x - w - 24);
    if (y + h + 12 > vh) y = Math.max(4, y - h - 24);
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  };
  WM.hideTip = function () { if (tipEl) tipEl.hidden = true; };

  /* ---------------- 渲染调度 ---------------- */
  /** σ 只对高斯核有效；样条模式下置灰，避免「调了没反应」 */
  function syncSmoothEnabled() {
    var sel = $('selSmooth');
    if (!sel) return;
    var gauss = (S.wafer.interpMethod === 'gauss');
    sel.disabled = !gauss;
    sel.title = gauss ? '' : '仅「高斯核」插值使用此参数';
  }

  function render() {
    renderPending = false;
    try {
      WM.renderView(S);
      updateStatusbar();
      updateColorbar();
    } catch (e) {
      console.error(e);
      WM.toast('渲染失败：' + e.message, 'err');
    }
  }
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    global.requestAnimationFrame(render);
  }
  WM.rerender = scheduleRender;

  /* ---------------- 数据集装载 ---------------- */
  function decodeBuffer(buf) {
    var u8 = new Uint8Array(buf);
    var txt = '';
    try { txt = new TextDecoder('utf-8', { fatal: false }).decode(u8); } catch (e) { txt = ''; }
    if (!txt || txt.indexOf('\ufffd') >= 0) {
      try { var alt = new TextDecoder('gbk').decode(u8); if (alt && alt.indexOf('\ufffd') < 0) txt = alt; } catch (e2) { }
    }
    return txt;
  }

  /** 二维数组 → 数据集（CSV 与 Excel 共用同一入口） */
  function applyRawRows(raw, name, meta) {
    var ds;
    try {
      ds = WM.buildDataset(raw);
    } catch (e) {
      WM.toast('解析失败：' + e.message, 'err');
      return false;
    }
    meta = meta || {};
    S.dataset = ds;
    S.srcName = name || 'data.csv';
    S.workbook = meta.workbook || null;
    S.sheetNames = meta.sheetNames || [];
    S.sheet = meta.sheet || '';
    S.active = 0;
    refreshFromDataset();
    buildColumnSelectors();
    WM.toast('已载入 ' + S.srcName + (S.sheet ? ' · ' + S.sheet : '') +
      '：' + S.points.length + ' 点 × ' + S.valueNames.length + ' 列');
    render();
    return true;
  }

  function loadCSV(text, name) {
    var raw;
    try {
      raw = WM.parseCSV(text);
    } catch (e) {
      WM.toast('解析失败：' + e.message, 'err');
      return false;
    }
    return applyRawRows(raw, name, {});
  }

  /* ---------------- Excel（.xlsx/.xlsm/.xls） ---------------- */
  function sheetToRows(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];
    var rows = global.XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: true, defval: '', blankrows: false
    });
    // 统一成「数字 / 字符串」两种，其余（日期、布尔）转字符串
    return rows.map(function (r) {
      return (r || []).map(function (v) {
        if (v === null || v === undefined) return '';
        if (typeof v === 'number' || typeof v === 'string') return v;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      });
    });
  }

  /** 选默认工作表：优先「至少有 3 列、2 行数字」的那张，否则第一张非空表 */
  function pickSheet(wb) {
    var names = wb.SheetNames || [];
    for (var i = 0; i < names.length; i++) {
      var rows = sheetToRows(wb, names[i]);
      if (!rows.length) continue;
      var numericCols = 0;
      for (var c = 0; c < (rows[0] || []).length; c++) {
        var hits = 0;
        for (var r = 1; r < Math.min(rows.length, 12); r++) {
          if (isFinite(WM.util.num(rows[r][c]))) hits++;
        }
        if (hits >= Math.min(3, rows.length - 1)) numericCols++;
      }
      if (numericCols >= 3) return names[i];
    }
    for (var k = 0; k < names.length; k++) {
      if (sheetToRows(wb, names[k]).length) return names[k];
    }
    return names[0] || '';
  }

  function loadSheet(wb, sheetName, name) {
    var rows;
    try {
      rows = sheetToRows(wb, sheetName);
    } catch (e) {
      WM.toast('读取工作表失败：' + e.message, 'err');
      return false;
    }
    if (!rows.length) { WM.toast('工作表「' + sheetName + '」没有数据', 'err'); return false; }

    // Excel 常见：首行是报告标题（只有 1~2 个非空单元格），真正的表头在第 2 行起
    var filled = function (r) {
      var n = 0;
      for (var i = 0; i < (r || []).length; i++) if (String(r[i]).trim() !== '') n++;
      return n;
    };
    if (rows.length > 1 && filled(rows[0]) < 3 && filled(rows[1]) >= 3) {
      rows = rows.slice(1);
      WM.toast('已跳过工作表顶部标题行');
    }
    return applyRawRows(rows, name, { workbook: wb, sheetNames: (wb.SheetNames || []).slice(), sheet: sheetName });
  }

  function loadWorkbook(buf, name) {
    if (!global.XLSX) { WM.toast('Excel 解析库未加载（vendor/xlsx.full.min.js）', 'err'); return false; }
    var wb;
    try {
      wb = global.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
    } catch (e) {
      WM.toast('Excel 解析失败：' + e.message, 'err');
      return false;
    }
    var sheet = pickSheet(wb);
    if (!sheet) { WM.toast('工作簿里没有可读的工作表', 'err'); return false; }
    return loadSheet(wb, sheet, name);
  }

  /** 由当前 dataset + 列选择重建 points / 全局范围 / 晶圆半径 */
  function refreshFromDataset() {
    var ds = S.dataset;
    var mp = WM.makePoints(ds);
    S.points = mp.points;
    S.skipped = mp.skipped;
    S.valueNames = ds.valueNames.slice();

    var lo = Infinity, hi = -Infinity, rmax = 0;
    for (var i = 0; i < S.points.length; i++) {
      var p = S.points[i];
      for (var c = 0; c < p.v.length; c++) {
        var v = p.v[c];
        if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      var r = Math.sqrt(p.x * p.x + p.y * p.y);
      if (isFinite(r) && r > rmax) rmax = r;
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    S.globalRange = { min: lo, max: hi };
    S.waferRadius = Math.max(10, Math.ceil(rmax / 10) * 10);
    if (S.active >= S.valueNames.length) S.active = Math.max(0, S.valueNames.length - 1);
    updateDsinfo();
  }

  /** 重设坐标列；膜厚列 = 除 X/Y 之外的全部数值列（自动，无需勾选） */
  function applyColumns() {
    var ds = S.dataset;
    if (!ds) return;
    var xc = Number($('selX').value), yc = Number($('selY').value);
    if (xc === yc) {
      WM.toast('X 与 Y 不能是同一列', 'err');
      $('selX').value = String(ds.xCol);
      $('selY').value = String(ds.yCol);
      return;
    }
    var vc = [], vn = [];
    ds.names.forEach(function (nm, i) {
      if (!ds.numeric[i] || i === xc || i === yc) return;
      vc.push(i); vn.push(nm);
    });
    if (!vc.length) { WM.toast('除坐标列外找不到数值列', 'err'); return; }
    ds.xCol = xc; ds.yCol = yc; ds.valueCols = vc; ds.valueNames = vn;
    S.active = 0;
    refreshFromDataset();
    render();
  }

  /* ---------------- 面板构建 ---------------- */
  function buildColumnSelectors() {
    var ds = S.dataset; if (!ds) return;
    ['selX', 'selY'].forEach(function (id, k) {
      var sel = $(id);
      sel.innerHTML = '';
      ds.names.forEach(function (nm, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = nm + '  [' + (i + 1) + ']' + (ds.numeric[i] ? '' : ' · 非数值');
        sel.appendChild(o);
      });
      sel.value = String(k === 0 ? ds.xCol : ds.yCol);
    });
  }

  /** 色阶下拉（默认 Jet） */
  function buildRampSelect() {
    var sel = $('selRamp');
    if (!sel) return;
    if (!sel.options.length) {
      WM.scales.forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        o.textContent = WM.scaleLabel[name] || name;
        sel.appendChild(o);
      });
    }
    sel.value = S.scale.name;
  }

  /** 设定 LSL/USL 时自动把 In Spec 加入统计显示项（否则用户设了规格看不到结果） */
  function ensureInSpecItem() {
    if (!(isFinite(S.spec.lsl) || isFinite(S.spec.usl))) return;
    if (S.stats.items.indexOf('inspec') >= 0) return;
    S.stats.items = STAT_ORDER.filter(function (k) {
      return S.stats.items.indexOf(k) >= 0 || k === 'inspec';
    });
    buildStatItems();
  }

  function buildStatItems() {
    var box = $('statItems');
    box.innerHTML = '';
    STAT_ORDER.forEach(function (k) {
      if (k === 'inspec') return;   // 只在设定 LSL/USL 后自动出现，不占勾选项
      var lab = document.createElement('label');
      lab.className = 'ck';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = k; cb.id = 'st-' + k;
      cb.checked = S.stats.items.indexOf(k) >= 0;
      cb.addEventListener('change', function () {
        var sel = [];
        STAT_ORDER.forEach(function (kk) { if ($('st-' + kk).checked) sel.push(kk); });
        if (!sel.length) { WM.toast('至少选择一项统计量', 'err'); cb.checked = true; return; }
        S.stats.items = sel;
        render();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(STAT_LABEL[k]));
      box.appendChild(lab);
    });
  }

  /* ---------------- 色阶条 / 状态栏 ---------------- */
  function updateColorbar() {
    var grad = $('cbarGrad');
    if (!grad) return;
    grad.style.background = WM.cssGradient(S.scale.name, S.scale.reverse);
    var lo = '—', hi = '—';
    if (S.points.length) {
      var col = WM.extractColumn(S.points, S.active);
      var dom = WM.colorDomain(S, col.values);
      lo = U.fmt(dom.min, S.digits); hi = U.fmt(dom.max, S.digits);
    }
    $('cbarMin').textContent = lo;
    $('cbarMax').textContent = hi;
  }

  function updateDsinfo() {
    var txt;
    if (!S.dataset) {
      txt = '未载入数据';
    } else {
      txt = S.srcName + (S.sheet ? ' · ' + S.sheet : '') + ' · ' + S.points.length + ' 点 × ' + S.valueNames.length + ' 列' +
        (S.skipped ? ' · 跳过 ' + S.skipped + ' 行' : '');
    }
    var a = $('dsinfo'); if (a) a.textContent = txt;
    var b = $('dsName'); if (b) b.textContent = S.dataset ? S.srcName : '未载入';
  }

  function updateStatusbar() {
    var parts = [];
    if (S.dataset) {
      parts.push('数据 ' + S.srcName + (S.sheet ? ' / ' + S.sheet : ''));
      parts.push('测点 ' + S.points.length);
      parts.push('膜厚列 ' + S.valueNames.length);
      parts.push('晶圆半径 ' + Math.round(S.waferRadius) + ' mm');
      parts.push('色阶 ' + (WM.scaleLabel[S.scale.name] || S.scale.name) +
        (S.scale.domain === 'manual' ? '（手动）' : S.scale.domain === 'global' ? '（全局）' : '（每图）'));
      var col = WM.extractColumn(S.points, S.active);
      var st = WM.stat(col.values);
      parts.push('当前 ' + (S.valueNames[S.active] || '') + ' Mean ' + U.fmt(st.mean, S.digits) + ' · Nu% ' + U.fmt(st.nu, 2));
    } else {
      parts.push('未载入数据');
    }
    parts.push('小数位 ' + S.digits);
    var sb = $('statusbar'); if (sb) sb.textContent = parts.join('   |   ');
  }

  /* ---------------- 视图 / 选中控制（供 views 调用） ---------------- */
  WM.setActive = function (i) {
    if (!S.valueNames.length) return;
    S.active = Math.max(0, Math.min(S.valueNames.length - 1, i | 0));
    if (S.view !== 'single') { S.view = 'single'; syncTabs(); }
    render();
  };
  WM.setView = function (v) {
    S.view = v; syncTabs(); render();
  };
  WM.setGalleryMode = function (m) { S.galleryMode = m; render(); };
  WM.setProfileMerge = function (v) { S.chart.profileMerge = !!v; render(); };
  WM.setGalleryTab = function (t) { S.galleryTab = (t === 'line' ? 'line' : 'map'); render(); };

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === S.view);
    });
  }

  /* ---------------- 导入 ---------------- */
  /** 判定是否 Excel 容器：扩展名优先，其次看文件头（xlsx = PK, xls = OLE2） */
  function isExcelFile(file, buf) {
    var nm = String(file.name || '').toLowerCase();
    if (/\.(xlsx|xlsm|xlsb|xls)$/.test(nm)) return true;
    if (!buf || buf.byteLength < 4) return false;
    var b = new Uint8Array(buf, 0, 4);
    var isZip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    var isOle = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
    return isZip || isOle;
  }

  function readFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var buf = fr.result;
      try {
        if (isExcelFile(file, buf)) loadWorkbook(buf, file.name);
        else loadCSV(decodeBuffer(buf), file.name);
      } catch (e) {
        WM.toast('文件解析失败：' + e.message, 'err');
      }
    };
    fr.onerror = function () { WM.toast('文件读取失败', 'err'); };
    fr.readAsArrayBuffer(file);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    /* 顶栏 */
    $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (ev) {
      readFile(ev.target.files && ev.target.files[0]);
      ev.target.value = '';
    });
    $('btnExportAll').addEventListener('click', function () {
      var cards = WM.currentCards || [];
      if (!cards.length) { WM.toast('当前没有可导出的图', 'err'); return; }
      var viewLabel = { single: '单晶圆', gallery: '全量网格', stats: '统计对比' }[S.view] || S.view;
      var name = WM.baseName(S.srcName) + '-' + S.view + '-' + WM.timestamp() + '.png';
      var title = WM.baseName(S.srcName) + ' · ' + viewLabel + ' · ' + cards.length + ' 图';
      WM.exportComposite(cards, name, title).then(function () {
        WM.toast('已导出 ' + cards.length + ' 张图拼版 PNG');
      }).catch(function (e) { WM.toast('导出失败：' + (e.message || e), 'err'); });
    });
    $('btnExportCSV').addEventListener('click', function () {
      if (!S.points.length) { WM.toast('未载入数据', 'err'); return; }
      WM.downloadText(WM.statsCSV(S), WM.baseName(S.srcName) + '-stats-' + WM.timestamp() + '.csv');
    });

    /* 视图 tab */
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.addEventListener('click', function () { WM.setView(b.getAttribute('data-view')); });
    });

    /* 数据 */
    $('selX').addEventListener('change', applyColumns);
    $('selY').addEventListener('change', applyColumns);
    $('selUnit').addEventListener('change', function () { S.unit = this.value; render(); });

    /* 色阶 */
    $('selRamp').addEventListener('change', function () { S.scale.name = this.value; render(); });
    $('chkReverse').addEventListener('change', function () { S.scale.reverse = this.checked; render(); });
    $('selLevels').addEventListener('change', function () { S.scale.levels = Number(this.value); render(); });
    $('selDomain').addEventListener('change', function () {
      S.scale.domain = this.value;
      $('manualRangeRow').hidden = (this.value !== 'manual');
      render();
    });
    ['inpMin', 'inpMax'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.scale.min = parseFloat($('inpMin').value);
        S.scale.max = parseFloat($('inpMax').value);
        if (!isFinite(S.scale.min) || !isFinite(S.scale.max) || S.scale.max <= S.scale.min) {
          if (S.scale.domain === 'manual') WM.toast('手动范围需要 Min < Max', 'err');
        } else { render(); }
      });
    });

    /* Wafer Map */
    $('selSignSize').addEventListener('change', function () {
      S.wafer.size = Number(this.value);
      render();
    });
    $('chkInterp').addEventListener('change', function () { S.wafer.interp = this.checked; render(); });
    $('chkContour').addEventListener('change', function () { S.wafer.contour = this.checked; render(); });
    $('selInterpRes').addEventListener('change', function () { S.wafer.interpRes = Number(this.value); render(); });
    $('selSmooth').addEventListener('change', function () { S.wafer.interpSmooth = Number(this.value); render(); });
    $('selInterpMethod').addEventListener('change', function () {
      S.wafer.interpMethod = this.value;
      syncSmoothEnabled();
      render();
    });
    $('chkSigns').addEventListener('change', function () { S.wafer.signs = this.checked; render(); });
    $('chkLabels').addEventListener('change', function () { S.wafer.labels = this.checked; render(); });
    $('chkOutline').addEventListener('change', function () { S.wafer.outline = this.checked; render(); });
    $('chkLegend').addEventListener('change', function () { S.wafer.legend = this.checked; render(); });
    ['inpLsl', 'inpUsl'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.spec.lsl = $('inpLsl').value.trim() === '' ? NaN : parseFloat($('inpLsl').value);
        S.spec.usl = $('inpUsl').value.trim() === '' ? NaN : parseFloat($('inpUsl').value);
        ensureInSpecItem();
        render();
      });
    });

    /* 统计 */
    $('selDigits').addEventListener('change', function () { S.digits = Number(this.value); U.digits = S.digits; render(); });

    /* 图表 */
    $('selBins').addEventListener('change', function () { S.chart.bins = Number(this.value); render(); });
    $('chkMean').addEventListener('change', function () { S.chart.showMean = this.checked; render(); });
    $('chkSigma').addEventListener('change', function () { S.chart.showSigma = this.checked; render(); });
    $('chkFit').addEventListener('change', function () { S.chart.showFit = this.checked; render(); });
    $('chkValues').addEventListener('change', function () { S.chart.showValues = this.checked; render(); });

    /* 拖放导入 */
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget) return;
        document.body.classList.remove('dragging');
      });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    /* 快捷键 */
    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { WM.setActive(S.active + 1); }
      else if (e.key === 'ArrowLeft') { WM.setActive(S.active - 1); }
      else if (e.key === '1') { WM.setView('single'); }
      else if (e.key === '2') { WM.setView('gallery'); }
      else if (e.key === '3') { WM.setView('stats'); }
    });

    /* 分隔条拖拽（设置区宽度） */
    var splitter = $('splitter'), panel = $('panel');
    var dragging = false;
    splitter.addEventListener('mousedown', function (e) {
      dragging = true; e.preventDefault(); document.body.classList.add('resizing');
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var w = Math.max(240, Math.min(520, e.clientX));
      panel.style.width = w + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
      try { localStorage.setItem('wm.panelWidth', panel.style.width); } catch (err) { }
      render();
    });
    splitter.addEventListener('dblclick', function () {
      panel.style.width = '300px';
      render();
    });
    try {
      var pw = localStorage.getItem('wm.panelWidth');
      if (pw) panel.style.width = pw;
    } catch (err) { }
  }

  /* ---------------- 对外测试接口 ---------------- */
  WM.api = {
    loadText: function (t, n) { return loadCSV(t, n); },
    loadWorkbook: function (buf, n) { return loadWorkbook(buf, n); },
    selectSheet: function (n) { return loadSheet(S.workbook, n, S.srcName); },
    setView: function (v) { WM.setView(v); },
    setActive: function (i) { WM.setActive(i); },
    setGalleryMode: function (m) { WM.setGalleryMode(m); },
    setProfileMerge: function (v) { WM.setProfileMerge(v); },
    setGalleryTab: function (t) { WM.setGalleryTab(t); },
    setDigits: function (d) { S.digits = d; U.digits = d; $('selDigits').value = String(d); render(); },
    setScale: function (o) {
      Object.assign(S.scale, o);
      buildRampSelect(); $('selDomain').value = S.scale.domain;
      $('manualRangeRow').hidden = (S.scale.domain !== 'manual');
      if (isFinite(S.scale.min)) $('inpMin').value = S.scale.min;
      if (isFinite(S.scale.max)) $('inpMax').value = S.scale.max;
      $('chkReverse').checked = !!S.scale.reverse;
      $('selLevels').value = String(S.scale.levels || 0);
      render();
    },
    setWafer: function (o) {
      Object.assign(S.wafer, o);
      $('chkSigns').checked = !!S.wafer.signs;
      $('chkInterp').checked = !!S.wafer.interp;
      $('chkContour').checked = S.wafer.contour !== false;
      $('selInterpRes').value = String(S.wafer.interpRes);
      $('selSmooth').value = String(S.wafer.interpSmooth);
    $('selInterpMethod').value = S.wafer.interpMethod;
    syncSmoothEnabled();
      $('chkLabels').checked = !!S.wafer.labels;
      $('chkLegend').checked = S.wafer.legend !== false;
      $('selSignSize').value = String(S.wafer.size);
      render();
    },
    setSpec: function (lsl, usl) {
      S.spec.lsl = lsl; S.spec.usl = usl;
      $('inpLsl').value = isFinite(lsl) ? lsl : '';
      $('inpUsl').value = isFinite(usl) ? usl : '';
      ensureInSpecItem();
      render();
    },
    setStatsItems: function (arr) {
      S.stats.items = STAT_ORDER.filter(function (k) { return arr.indexOf(k) >= 0; });
      buildStatItems(); render();
    },
    getState: function () {
      return {
        view: S.view, active: S.active, digits: S.digits, unit: S.unit,
        points: S.points.length, skipped: S.skipped || 0,
        valueNames: S.valueNames.slice(),
        srcName: S.srcName,
        sheet: S.sheet,
        sheetNames: (S.sheetNames || []).slice(),
        waferRadius: S.waferRadius,
        globalRange: S.globalRange,
        scale: JSON.parse(JSON.stringify(S.scale)),
        wafer: JSON.parse(JSON.stringify(S.wafer)),
        spec: { lsl: isFinite(S.spec.lsl) ? S.spec.lsl : null, usl: isFinite(S.spec.usl) ? S.spec.usl : null },
        statsItems: S.stats.items.slice(),
        profileMerge: !!S.chart.profileMerge,
        galleryTab: S.galleryTab,
        showValues: !!S.chart.showValues,
        cards: (WM.currentCards || []).map(function (c) { return { title: c.title, group: c.group, kind: c.kind, has: !!c.ref }; }),
        renderCounter: WM.renderCounter || 0
      };
    },
    getStat: function (i) {
      var col = WM.extractColumn(S.points, i === undefined ? S.active : i);
      var st = WM.stat(col.values);
      return { name: S.valueNames[i === undefined ? S.active : i], n: st.n, mean: st.mean, median: st.median, std: st.std, min: st.min, max: st.max, range: st.range, nu: st.nu };
    },
    statsCSV: function () { return WM.statsCSV(S); },
    dataCSV: function () { return WM.dataCSV(S); },
    currentCards: function () { return (WM.currentCards || []).map(function (c) { return { title: c.title, group: c.group, kind: c.kind }; }); },
    exportAll: function (name) { return WM.exportComposite(WM.currentCards || [], name); }
  };

  /* ---------------- 启动 ---------------- */
  function boot() {
    buildStatItems();
    buildRampSelect();
    $('selDigits').value = String(S.digits);
    $('selUnit').value = S.unit;
    $('selSignSize').value = String(S.wafer.size);
    $('chkSigns').checked = S.wafer.signs;
    $('chkInterp').checked = S.wafer.interp;
    $('chkContour').checked = S.wafer.contour !== false;
    $('selInterpRes').value = String(S.wafer.interpRes);
    $('selSmooth').value = String(S.wafer.interpSmooth);
    $('chkLabels').checked = S.wafer.labels;
    $('chkOutline').checked = S.wafer.outline;
    $('chkLegend').checked = S.wafer.legend !== false;
    $('selBins').value = String(S.chart.bins);
    $('chkValues').checked = S.chart.showValues;
    $('chkMean').checked = S.chart.showMean;
    $('chkSigma').checked = S.chart.showSigma;
    $('chkFit').checked = S.chart.showFit;
    U.digits = S.digits;
    bind();
    // 空白启动：不内置、不载入任何示例数据（用户导入自己的文件）
    render();
    WM.ready = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
