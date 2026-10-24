'use strict';
/* ==========================================================================
   验收套件（Playwright + file://）
   逐条断言需求，末行输出 PASS a / b 或 FAIL a / b，失败退出码 1
   运行：node tests/acceptance.js
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const synth = require('./helpers/synthetic');
require('./make_fixtures');   // 夹具由脚本生成（仓库不含 xlsx）
const DL = path.join(__dirname, 'dl-acc');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

/* 合成测试数据（运行时生成，不入库、不含真实测量值） */
const CSV = path.join(DL, 'synthetic.csv');
fs.writeFileSync(CSV, synth.toCsv(), 'utf8');

/** 通过顶部「导入数据」载入一份 CSV（等同用户操作） */
async function importCsv(page, file) {
  await page.setInputFiles('#fileInput', file);
  await page.waitForTimeout(800);
}

let pass = 0, total = 0;
const log = [];
function ok(name, cond, detail) {
  total++;
  if (cond) { pass++; log.push('  ok   ' + name); }
  else log.push('  FAIL ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
}
function near(name, got, want, tol) {
  ok(name, typeof got === 'number' && Math.abs(got - want) <= tol, { got: got, want: want, tol: tol });
}

/* ---------- 独立实现的统计（用于交叉校验，不复用被测代码） ---------- */
function expectedStats(values) {
  const v = values.filter((x) => isFinite(x));
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const ss = v.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const std = Math.sqrt(ss / (n - 1));
  const s = v.slice().sort((a, b) => a - b);
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, mean, median, std, min: s[0], max: s[n - 1], range: s[n - 1] - s[0], nu: std / Math.abs(mean) * 100 };
}
function readCSV(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  const rows = txt.trim().split(/\r?\n/).map((l) => l.split(','));
  const head = rows[0];
  const data = rows.slice(1).map((r) => r.map(Number));
  return { head, data };
}

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  const src = readCSV(CSV);
  const colTK1 = src.head.indexOf('TK1');
  const expTK1 = expectedStats(src.data.map((r) => r[colTK1]));

  /* -------- S1 启动空白（发布版不自动打开示例数据） -------- */
  const empty0 = await page.evaluate(() => ({
    st: window.WM.api.getState(),
    emptyDom: !!document.querySelector('#viewRoot .empty'),
    emptyTitle: (document.querySelector('#viewRoot .empty-t') || {}).textContent || '',
    emptyHint: (document.querySelector('#viewRoot .empty-s') || {}).textContent || '',
    dsinfo: (document.getElementById('dsinfo') || {}).textContent || '',
    hasEmbeddedData: !!(window.WM_DEMO || window.WM_SAMPLE)
  }));
  ok('S1 启动不自动载入数据（视图区显示「未载入数据」）',
    empty0.st.points === 0 && empty0.emptyDom && /未载入数据/.test(empty0.emptyTitle), empty0);
  ok('S1 空状态提示引导导入文件（不再提「载入示例」）',
    /导入数据/.test(empty0.emptyHint) && !/载入示例/.test(empty0.emptyHint), empty0.emptyHint);
  ok('S1 顶栏数据源显示「未载入」', /未载入/.test(empty0.dsinfo), empty0.dsinfo);
  ok('S1 包内不含任何内嵌数据', empty0.hasEmbeddedData === false, empty0.hasEmbeddedData);

  // 后续断言需要数据：通过「导入数据」载入合成 CSV
  await importCsv(page, CSV);
  await page.waitForTimeout(400);

  const st0 = await page.evaluate(() => window.WM.api.getState());
  ok('S1 导入后：49 测点 × 10 膜厚列',
    st0.points === 49 && st0.valueNames.length === 10, st0);
  ok('S1 膜厚列名与 CSV 表头一致', st0.valueNames.join(',') === src.head.slice(2).join(','), st0.valueNames);

  /* -------- S2 零外部请求 -------- */
  const ext = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /^https?:/.test(r.name)).map((r) => r.name));
  ok('S2 零外部网络请求（file:// 可离线双击运行）', ext.length === 0, ext);

  /* -------- S2b 默认设置 -------- */
  const defaults = await page.evaluate(() => ({
    rampTag: (document.getElementById('selRamp') || {}).tagName,
    rampValue: (document.getElementById('selRamp') || {}).value,
    rampOptions: (document.getElementById('selRamp') || {}).options ? document.getElementById('selRamp').options.length : 0,
    scale: window.WM.api.getState().scale.name,
    digits: window.WM.api.getState().digits,
    digitsUi: document.getElementById('selDigits').value,
    labels: window.WM.api.getState().wafer.labels,
    labelsUi: document.getElementById('chkLabels').checked,
    swatches: document.querySelectorAll('.ramp').length
  }));
  ok('S2b 色阶为下拉框（9 套预设），默认 Jet',
    defaults.rampTag === 'SELECT' && defaults.rampOptions >= 9 && defaults.rampValue === 'jet' && defaults.scale === 'jet', defaults);
  ok('S2b 旧的色块网格已移除', defaults.swatches === 0, defaults.swatches);
  ok('S2b 小数位默认 2', defaults.digits === 2 && defaults.digitsUi === '2', defaults);
  ok('S2b 数值标签默认开启', defaults.labels === true && defaults.labelsUi === true, defaults);

  /* -------- S3 晶圆图渲染 -------- */
  await page.waitForTimeout(400);
  const wafer = await page.evaluate(() => {
    const cv = document.querySelector('#viewRoot .wafer-canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const cx = cv.width / 2, cy = cv.height / 2, R = Math.min(cv.width, cv.height) / 2 - 10;
    const seen = new Set();
    let inside = 0;
    for (let y = 0; y < cv.height; y += 3) {
      for (let x = 0; x < cv.width; x += 3) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > R * R * 0.81) continue;
        const i = (y * cv.width + x) * 4;
        if (d[i + 3] < 250) continue;
        inside++;
        seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
    }
    return { w: cv.width, h: cv.height, inside, colors: seen.size };
  });
  ok('S3 晶圆 canvas 存在且尺寸 ≥ 400px（2× DPR）', !!wafer && wafer.w >= 400 && wafer.h >= 400, wafer);
  ok('S3 晶圆内部有颜色填充（多色 > 40 种）', !!wafer && wafer.colors > 40, wafer);

  /* -------- S4/S5 统计条 -------- */
  const strip = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.card-wafer .stats-strip .stat-cell')];
    return cells.map((c) => ({ k: c.getAttribute('data-stat'), label: c.querySelector('.sl').textContent, v: c.querySelector('.sv').textContent.trim() }));
  });
  const keys = strip.map((c) => c.k);
  ok('S4 统计条位于晶圆图下方且含 Mean/Median/Std/Range/Nu%',
    ['mean', 'median', 'std', 'range', 'nu'].every((k) => keys.includes(k)), keys);
  const get = (k) => parseFloat((strip.find((c) => c.k === k) || {}).v);
  near('S5 Mean 与独立计算一致', get('mean'), expTK1.mean, 5e-3);
  near('S5 Median 与独立计算一致', get('median'), expTK1.median, 5e-3);
  near('S5 Std（样本 n−1）与独立计算一致', get('std'), expTK1.std, 5e-3);
  near('S5 Range 与独立计算一致', get('range'), expTK1.range, 5e-3);
  near('S5 Nu% = Std/|Mean|×100 与独立计算一致', get('nu'), expTK1.nu, 5e-3);

  /* -------- S6 小数位默认两位 + 可切换 -------- */
  const dDefault = await page.evaluate(() => ({
    ui: document.getElementById('selDigits').value,
    state: window.WM.api.getState().digits,
    cell: document.querySelector('.card-wafer .stats-strip .stat-cell[data-stat=mean] .sv').textContent.trim()
  }));
  ok('S6 默认小数位 = 2（下拉与状态一致）', dDefault.ui === '2' && dDefault.state === 2, dDefault);
  ok('S6 默认统计值显示两位小数', String(dDefault.cell).indexOf(expTK1.mean.toFixed(2)) === 0, dDefault.cell);

  await page.evaluate(() => window.WM.api.setDigits(1));
  await page.waitForTimeout(250);
  const d1 = await page.evaluate(() => {
    const c = document.querySelector('.card-wafer .stats-strip .stat-cell[data-stat=mean] .sv');
    return c ? c.textContent.trim() : '';
  });
  ok('S6 小数位=1 时 Mean 显示 1 位小数', String(d1).indexOf(expTK1.mean.toFixed(1)) === 0, d1);
  await page.evaluate(() => window.WM.api.setDigits(0));
  await page.waitForTimeout(250);
  const d0 = await page.evaluate(() => document.querySelector('.card-wafer .stats-strip .stat-cell[data-stat=mean] .sv').textContent.trim());
  ok('S6 小数位=0 时 Mean 无小数', /^\d+$/.test(d0.replace(/[^\d.]/g, '')), d0);
  await page.evaluate(() => window.WM.api.setDigits(3));
  await page.waitForTimeout(250);
  const d3 = await page.evaluate(() => document.querySelector('.card-wafer .stats-strip .stat-cell[data-stat=mean] .sv').textContent.trim());
  ok('S6 小数位=3 生效', String(d3).indexOf(expTK1.mean.toFixed(3)) === 0, d3);
  await page.evaluate(() => window.WM.api.setDigits(2));
  await page.waitForTimeout(250);

  /* -------- S7 ± 符号 -------- */
  const signTest = await page.evaluate(async () => {
    const grab = () => {
      const cv = document.querySelector('#viewRoot .wafer-canvas');
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const cx = cv.width / 2, cy = cv.height / 2, R = Math.min(cv.width, cv.height) / 2 - 10;
      let bright = 0, dark = 0;
      for (let y = 0; y < cv.height; y += 2) {
        for (let x = 0; x < cv.width; x += 2) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > R * R * 0.81) continue;
          const i = (y * cv.width + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (r > 215 && g > 215 && b > 215) bright++;
          if (r < 45 && g < 45 && b < 45) dark++;
        }
      }
      return { bright, dark, url: cv.toDataURL().length };
    };
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.WM.api.setWafer({ signs: false, labels: false });
    await wait();
    const off = grab();
    window.WM.api.setWafer({ signs: true, labels: false });
    await wait();
    const on = grab();
    return { off, on };
  });
  ok('S7 关闭 ± 号后画面变化（数据 URL 长度不同）', signTest.off.url !== signTest.on.url, signTest);
  ok('S7 打开 ± 号后符号墨迹显著增加（总黑白像素）',
    (signTest.on.bright + signTest.on.dark) > (signTest.off.bright + signTest.off.dark) + 80,
    signTest);
  ok('S7 符号为单色填充（暗底白字多 → 暗底外仍以深色像素为主）',
    signTest.on.dark > signTest.off.dark + 50, signTest);

  /* -------- S8 色阶切换 -------- */
  const scaleTest = await page.evaluate(async () => {
    const snap = () => document.querySelector('#viewRoot .wafer-canvas').toDataURL();
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const a = snap();
    window.WM.api.setScale({ name: 'viridis' });
    await wait();
    const b = snap();
    window.WM.api.setScale({ name: 'jet', reverse: false, levels: 0 });
    await wait();
    const c = snap();
    return { changed: a !== b, restored: a === c };
  });
  ok('S8 切换色阶后重绘（像素变化）', scaleTest.changed, scaleTest);
  ok('S8 恢复原色阶后画面逐像素还原', scaleTest.restored, scaleTest);

  /* -------- S9 右侧图表：上 Lineplot、下 Boxplot -------- */
  const charts = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#viewRoot .card-chart')];
    const stack = document.querySelector('#viewRoot .stack2');
    return {
      titles: cards.map((c) => c.querySelector('.ct').textContent.trim()),
      drawn: cards.map((c) => {
        const cv = c.querySelector('canvas');
        return cv ? cv.toDataURL().length : 0;
      }),
      tops: stack ? [...stack.children].map((k) => Math.round(k.getBoundingClientRect().top)) : [],
      hasHist: /直方图/.test(document.querySelector('#viewRoot').textContent),
      waferTitle: (document.querySelector('.card-wafer .ct') || {}).textContent || ''
    };
  });
  ok('S9 右侧上下两张：上 Lineplot、下 Boxplot（直方图已移出单晶圆视图）',
    charts.titles.length === 2 && /^Lineplot/.test(charts.titles[0]) && /Boxplot/.test(charts.titles[1]) && charts.hasHist === false,
    charts.titles);
  ok('S9 晶圆卡片标题为 WaferMap', /^WaferMap/.test(charts.waferTitle.trim()), charts.waferTitle);
  ok('S9 两张图上下分布（同一列两个位置）',
    charts.tops.length === 2 && charts.tops[1] > charts.tops[0] + 50, charts.tops);
  ok('S9 两张图 canvas 均已渲染', charts.drawn.length === 2 && charts.drawn.every((d) => d > 2000), charts.drawn);

  /* -------- S10 悬停 tooltip -------- */
  const tip = await page.evaluate(async () => {
    window.WM.api.setWafer({ labels: true });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = document.querySelector('#viewRoot .wafer-canvas');
    const inst = cv.__wafer;
    const g = inst.geom;
    const r = cv.getBoundingClientRect();
    // 数据首点是圆心，直接用渲染器算出的屏幕坐标
    cv.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + g.px[0], clientY: r.top + g.py[0], bubbles: true }));
    const el = document.getElementById('tooltip');
    return { hidden: el.hidden, text: el.textContent };
  });
  ok('S10 悬停圆心测点弹出数值提示', tip.hidden === false && /TK1/.test(tip.text) && /值/.test(tip.text), tip);

  /* -------- S11 全量网格：WaferMap / LineProfile 两个 TAB -------- */
  await page.evaluate(() => { window.WM.api.setView('gallery'); window.WM.api.setGalleryTab('map'); });
  await page.waitForTimeout(1500);
  const gal = await page.evaluate(() => {
    const maps = [...document.querySelectorAll('.grid-map .card-wafer')];
    const widths = maps.map((m) => Math.round(m.getBoundingClientRect().width));
    return {
      maps: maps.length,
      profs: document.querySelectorAll('.grid-profile .card-chart').length,
      wMin: Math.min(...widths), wMax: Math.max(...widths),
      stripCount: maps.filter((m) => m.querySelectorAll('.stats-strip .stat-cell').length >= 2).length,
      tabs: [...document.querySelectorAll('.seg-tab .seg-btn')].map((b) => b.textContent),
      cards: window.WM.api.currentCards().length
    };
  });
  ok('S11 WaferMap 页只画 10 张晶圆图（不含折线）', gal.maps === 10 && gal.profs === 0, gal);
  ok('S11 每张晶圆图下方带统计（≥2 项）', gal.stripCount === 10, gal);
  ok('S11 网格卡片等宽（偏差 ≤1px）', gal.wMax - gal.wMin <= 1, gal);
  ok('S11 顶部只有 WaferMap / LineProfile 两个 TAB',
    gal.tabs.length === 2 && /WaferMap/.test(gal.tabs[0]) && /LineProfile/.test(gal.tabs[1]), gal.tabs);

  await page.evaluate(() => window.WM.api.setGalleryTab('line'));
  await page.waitForTimeout(1500);
  const gLine = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.grid-profile .card-chart')];
    return {
      lines: cards.length,
      drawn: cards.filter((c) => c.querySelector('canvas') && c.querySelector('canvas').toDataURL().length > 1500).length,
      maps: document.querySelectorAll('.grid-map .card-wafer').length,
      cards: window.WM.api.currentCards().length
    };
  });
  ok('S11 LineProfile 页画出 10 条折线且已渲染', gLine.lines === 10 && gLine.drawn === 10 && gLine.maps === 0, gLine);
  ok('S11 LineProfile 页 10 张图可导出', gLine.cards === 10, gLine);

  /* -------- S11b 合并一张 -------- */
  await page.evaluate(() => window.WM.api.setProfileMerge(true));
  await page.waitForTimeout(1200);
  const merged = await page.evaluate(() => {
    const box = document.querySelector('.grid-merged');
    return {
      hasBox: !!box,
      cards: document.querySelectorAll('.grid-merged .card-chart').length,
      drawable: box && box.querySelector('canvas') ? box.querySelector('canvas').toDataURL().length : 0,
      cardsTotal: window.WM.api.currentCards().length,
      mergeState: !!window.WM.api.getState().profileMerge
    };
  });
  ok('S11b 合并模式：全部膜厚列画进同一张 Lineplot', merged.hasBox && merged.cards === 1 && merged.drawable > 5000, merged);
  ok('S11b 合并模式可导出（1 张卡）', merged.cardsTotal === 1, merged);
  await page.evaluate(() => window.WM.api.setProfileMerge(false));
  await page.waitForTimeout(700);

  /* -------- S12 直方图视图仍可通过接口查看（界面无入口） -------- */
  await page.evaluate(() => { window.WM.api.setView('gallery'); window.WM.api.setGalleryMode('hist'); });
  await page.waitForTimeout(1200);
  const onlyHist = await page.evaluate(() => document.querySelectorAll('.grid-hist .card-chart').length);
  ok('S12 直方图视图（接口切换）仍能画出 10 张', onlyHist === 10, onlyHist);
  await page.evaluate(() => window.WM.api.setGalleryMode('all'));
  await page.waitForTimeout(800);

  /* -------- S13 统计对比表 -------- */
  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(500);
  const tbl = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.stats-table tbody tr')];
    return rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim()));
  });
  ok('S13 统计表覆盖 10 个膜厚列', tbl.length === 10, tbl.length);
  near('S13 表中 TK1 Mean 与独立计算一致', parseFloat(tbl[0][2]), expTK1.mean, 5e-3);
  near('S13 表中 TK1 Nu% 与独立计算一致', parseFloat(tbl[0][8]), expTK1.nu, 5e-3);

  /* -------- S14 规格判定 -------- */
  await page.evaluate(() => window.WM.api.setSpec(92, 108));
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(500);
  const spec = await page.evaluate(() => {
    const c = document.querySelector('.card-wafer .stats-strip .stat-cell[data-stat=inspec] .sv');
    return c ? c.textContent.trim() : null;
  });
  const inSpecExp = src.data.map((r) => r[colTK1]).filter((v) => v >= 92 && v <= 108).length / 49 * 100;
  ok('S14 设定 LSL/USL 后出现 In Spec 统计', spec !== null, spec);
  near('S14 In Spec% 与独立计算一致', parseFloat(spec), inSpecExp, 0.01);
  await page.evaluate(() => window.WM.api.setSpec(NaN, NaN));
  await page.waitForTimeout(400);

  /* -------- S15 单图 PNG 导出 -------- */
  const dlPath = path.join(DL, 'card.png');
  {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#viewRoot .card-chart .mini')]);
    await d.saveAs(dlPath);
  }
  const png = fs.readFileSync(dlPath);
  const isPNG = png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  ok('S15 单图 PNG 导出（魔数 + 尺寸 ≥ 700px）', isPNG && pw >= 700 && ph >= 600, { isPNG, pw, ph, bytes: png.length });

  /* -------- S16 拼版 PNG 导出 -------- */
  const compPath = path.join(DL, 'all.png');
  {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btnExportAll')]);
    await d.saveAs(compPath);
  }
  const comp = fs.readFileSync(compPath);
  const cw = comp.readUInt32BE(16), ch = comp.readUInt32BE(20);
  ok('S16 当前视图全部图导出为一张拼版 PNG（宽 2400）', comp.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) && cw === 2400 && ch > 400, { cw, ch, bytes: comp.length });

  /* -------- S41 单晶圆拼版按列布局（左地图 + 右上下两图） -------- */
  const comp2Path = path.join(DL, 'single-comp.png');
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(800);
  {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btnExportAll')]);
    await d.saveAs(comp2Path);
  }
  const c2 = fs.readFileSync(comp2Path);
  const c2w = c2.readUInt32BE(16), c2h = c2.readUInt32BE(20);
  ok('S41 单晶圆拼版按列布局（非垂直堆叠：高度 < 1700）',
    c2w === 2400 && c2h > 900 && c2h < 1700, { c2w, c2h, bytes: c2.length });

  /* -------- S17 统计 CSV 导出 -------- */
  const statsPath = path.join(DL, 'stats.csv');
  {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnExportCSV')]);
    await d.saveAs(statsPath);
  }
  const statsTxt = fs.readFileSync(statsPath, 'utf8').replace(/^\ufeff/, '');
  const statsRows = statsTxt.trim().split(/\r?\n/);
  ok('S17 统计 CSV：表头 + 10 列 + 1 脚注 = 12 行', statsRows.length === 12, statsRows.length);
  const tk1 = statsRows[1].split(',');
  ok('S17 统计 CSV 首行列名为 TK1', tk1[0] === 'TK1', tk1[0]);
  near('S17 统计 CSV 的 Mean 与独立计算一致', parseFloat(tk1[2]), expTK1.mean, 5e-3);
  near('S17 统计 CSV 的 Std 与独立计算一致', parseFloat(tk1[4]), expTK1.std, 5e-3);

  /* -------- S18 数据 CSV 导出 -------- */
  const dataPath = path.join(DL, 'data.csv');
  {
    const [okBtn] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.evaluate(() => {
        window.WM.api.setView('stats');
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const b = [...document.querySelectorAll('#subbar .mini')].find((x) => x.textContent.includes('导出数据'));
          b.click(); res(true);
        })));
      })
    ]);
    await okBtn.saveAs(dataPath);
  }
  const dataRows = fs.readFileSync(dataPath, 'utf8').replace(/^\ufeff/, '').trim().split(/\r?\n/);
  ok('S18 数据 CSV：表头 + 49 行', dataRows.length === 50, dataRows.length);
  ok('S18 数据 CSV 含 X,Y,R + 10 个膜厚列', dataRows[0].split(',').length === 13, dataRows[0]);
  near('S18 数据 CSV 首行 TK1 值与原文件一致', parseFloat(dataRows[1].split(',')[3]), src.data[0][colTK1], 1e-4);

  /* -------- S19 导入自建 CSV（tab 分隔 / 中文表头 / 无 BOM） -------- */
  const custom = path.join(DL, 'custom.csv');
  fs.writeFileSync(custom, 'X(mm)\tY(mm)\t膜厚A\t膜厚B\n0\t0\t100\t200\n50\t0\t102\t201\n0\t50\t98\t199\n-50\t0\t101\t203\n0\t-50\t99\t\n', 'utf8');
  await page.setInputFiles('#fileInput', custom);
  await page.waitForTimeout(900);
  const stCustom = await page.evaluate(() => window.WM.api.getState());
  ok('S19 导入 tab 分隔 CSV：5 个有效测点（末行缺 B 列仍保留）', stCustom.points === 5, stCustom.points);
  ok('S19 自动识别 2 个膜厚列（中文表头保留）', stCustom.valueNames.length === 2 && stCustom.valueNames[0] === '膜厚A', stCustom.valueNames);
  const meanA = await page.evaluate(() => window.WM.api.getStat(0).mean);
  near('S19 导入后统计正确 (mean=100)', meanA, 100, 1e-9);
  near('S19 缺测值被跳过 (膜厚B n=4)', (await page.evaluate(() => window.WM.api.getStat(1).n)), 4, 0);

  /* -------- S20 数值列切换（顶部 chips；膜厚列勾选已去掉） -------- */
  ok('S20 左侧已无膜厚列勾选控件', (await page.evaluate(() => !document.getElementById('valCols'))), true);
  await importCsv(page, CSV);
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(500);
  await page.click('#subbar .chip[data-col="4"]');
  await page.waitForTimeout(600);
  const st20 = await page.evaluate(() => ({ s: window.WM.api.getState(), stat: window.WM.api.getStat() }));
  ok('S20 点第 5 个 chip 切到 TK5', st20.s.active === 4 && st20.s.valueNames[4] === 'TK5', st20.s.active);
  const expTK5 = expectedStats(src.data.map((r) => r[src.head.indexOf('TK5')]));
  near('S20 切换后统计条均值随之更新', st20.stat.mean, expTK5.mean, 5e-3);

  /* -------- S22 默认色阶 Jet + 下拉框 -------- */
  await importCsv(page, CSV);
  const rampUi = await page.evaluate(() => ({
    tag: (document.getElementById('selRamp') || {}).tagName,
    value: (document.getElementById('selRamp') || {}).value,
    options: (document.getElementById('selRamp') || {}).options ? document.getElementById('selRamp').options.length : 0,
    state: window.WM.api.getState().scale.name,
    swatches: document.querySelectorAll('.ramp').length
  }));
  ok('S22 色阶仍为下拉框且与状态一致', rampUi.tag === 'SELECT' && rampUi.options >= 9 && rampUi.value === rampUi.state, rampUi);
  ok('S22 旧的色块网格已移除', rampUi.swatches === 0, rampUi.swatches);

  /* -------- S23 晶圆图：无圆形标记、无 notch 三角 -------- */
  await page.evaluate(() => window.WM.api.setWafer({ legend: false }));
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const cv = document.querySelector('#viewRoot .wafer-canvas');
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 10;
    const d = ctx.getImageData(0, 0, w, h).data;
    // 晶圆正下方圆外 2~12px 的一小片区域：原 notch 三角形会在这里留下描边像素
    let notchPixels = 0;
    for (let y = Math.round(cy + R + 2); y < Math.round(cy + R + 12); y++) {
      for (let x = Math.round(cx - 16); x < Math.round(cx + 16); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        if (!(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) notchPixels++;
      }
    }
    return { notchPixels: notchPixels, hasMarkerField: Object.prototype.hasOwnProperty.call(window.WM.state.wafer, 'marker') };
  });
  ok('S23 晶圆底部无 notch 三角形（圆外区域为纯白）', geo.notchPixels === 0, geo);
  ok('S23 渲染状态中已无圆形标记字段', geo.hasMarkerField === false, geo);

  /* -------- S29 色阶图例：独立画布，钉在晶圆画布右下角，不覆盖 map -------- */
  const legend = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.WM.api.setView('single');
    window.WM.api.setWafer({ legend: true, interp: true, labels: true, signs: true });
    await wait();

    const read = () => {
      const wrap = document.querySelector('.wafer-wrap');
      const cv = wrap.querySelector('.wafer-canvas');
      const lc = wrap.querySelector('.wafer-legend');
      const g = cv.__wafer.geom;
      if (!lc || lc.style.display === 'none') return { has: false, g: g };
      const box = {
        x: parseFloat(lc.style.left), y: parseFloat(lc.style.top),
        w: parseFloat(lc.style.width), h: parseFloat(lc.style.height)
      };
      // 矩形内离圆心最近的点，判断是否与圆相交
      const nx = Math.max(box.x, Math.min(g.cx, box.x + box.w));
      const ny = Math.max(box.y, Math.min(g.cy, box.y + box.h));
      const dist = Math.hypot(nx - g.cx, ny - g.cy);
      return {
        has: true, box: box, g: g, gap: dist - g.R,
        ideal: Math.min(g.w, g.h) / 2 - 10,
        pixels: lc.width * lc.height
      };
    };

    const on = read();
    document.getElementById('chkLegend').click();
    await wait();
    const off = read();
    document.getElementById('chkLegend').click();
    await wait();
    return { on: on, off: off };
  });

  ok('S29 图例是独立画布（DOM canvas，不在晶圆画布内）', legend.on.has && legend.on.pixels > 0, legend.on);
  ok('S29 图例定位在晶圆画布右下角、竖直朝向',
    legend.on.box.x > legend.on.g.cx && legend.on.box.y > legend.on.g.cy && legend.on.box.h > legend.on.box.w * 2,
    legend.on.box);
  ok('S29 图例矩形与圆不相交（不覆盖 map）', legend.on.gap > 0, { gap: legend.on.gap, R: legend.on.g.R });
  const g29 = legend.on.g;
  const expectR = Math.min(g29.w, g29.h) / 2 - 5 - (g29.w < 340 ? 10 : 24);
  ok('S29 晶圆半径 = 画布半径 − 标签边距（未被图例挤压）',
    Math.abs(g29.R - expectR) < 0.6, { R: g29.R, expectR: expectR });
  ok('S29 晶圆直径占显示区 ≥ 88%',
    g29.R * 2 >= Math.min(g29.w, g29.h) * 0.88, { ratio: +(g29.R * 2 / Math.min(g29.w, g29.h)).toFixed(3) });
  ok('S29 勾掉「色阶图例」后画布消失', legend.off.has === false, legend.off);

  /* -------- S30 直方图不再画 Mean/Median 竖线（网格视图的直方图模式） -------- */
  await page.evaluate(() => { window.WM.api.setView('gallery'); window.WM.api.setGalleryMode('hist'); });
  await page.waitForTimeout(1300);
  const histLines = await page.evaluate(() => {
    const card = document.querySelector('.grid-hist .card-chart');
    if (!card) return { found: false };
    const inst = window.echarts.getInstanceByDom(card.querySelector('.chart-box'));
    const opt = inst.getOption();
    const withMark = opt.series.filter((x) => x.markLine && x.markLine.data && x.markLine.data.length);
    return { found: true, series: opt.series.length, withMark: withMark.length };
  });
  ok('S30 直方图没有参考竖线（Mean/Median 只在标题里）',
    histLines.found && histLines.withMark === 0, histLines);
  await page.evaluate(() => window.WM.api.setGalleryMode('all'));
  await page.waitForTimeout(700);

  /* -------- S31 数值标签勾选框与状态一致 -------- */
  const labelUi = await page.evaluate(() => ({
    state: window.WM.api.getState().wafer.labels,
    ui: document.getElementById('chkLabels').checked
  }));
  ok('S31 「数值标签」勾选框与实际状态一致', labelUi.state === labelUi.ui, labelUi);

  /* -------- S32 「图表数值」开关（默认开） -------- */
  const readLabels = () => {
    const cards = [...document.querySelectorAll('#viewRoot .card-chart')];
    return cards.map((c) => {
      const inst = window.echarts.getInstanceByDom(c.querySelector('.chart-box'));
      if (!inst) return null;
      return { title: c.querySelector('.ct').textContent, on: inst.getOption().series.some((x) => !!(x.label && x.label.show)) };
    });
  };
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(700);
  const vDef = await page.evaluate(readLabels);
  const vUi = await page.evaluate(() => ({
    state: window.WM.api.getState().showValues,
    ui: document.getElementById('chkValues').checked
  }));
  ok('S32 图表数值默认开启（Lineplot 已带数值）',
    vUi.state === true && vUi.ui === true && vDef.some((c) => c && c.on), { vUi, vDef });

  await page.click('#chkValues');
  await page.waitForTimeout(700);
  const vOff = await page.evaluate(readLabels);
  ok('S32 取消勾选后 Lineplot 不再显示数值', vOff.every((c) => c && !c.on), vOff);

  await page.evaluate(() => { window.WM.api.setView('gallery'); window.WM.api.setGalleryMode('hist'); });
  await page.waitForTimeout(1300);
  await page.click('#chkValues');
  await page.waitForTimeout(1100);
  const vHist = await page.evaluate(readLabels);
  ok('S32 重新勾选后直方图柱顶也显示数值', vHist.length > 0 && vHist.every((c) => c && c.on), vHist);
  await page.evaluate(() => window.WM.api.setGalleryMode('all'));
  await page.waitForTimeout(700);

  /* -------- S33 晶圆卡片导出 PNG 含统计条 -------- */
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(700);
  const cvH = await page.evaluate(() => document.querySelector('.wafer-canvas').height);
  const waferPng = path.join(DL, 'wafer-card.png');
  {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.card-wafer .mini')]);
    await d.saveAs(waferPng);
  }
  const wbuf = fs.readFileSync(waferPng);
  const wW = wbuf.readUInt32BE(16), wH = wbuf.readUInt32BE(20);
  ok('S33 晶圆卡片 PNG 含底部统计条（比画布更高）',
    wbuf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) && wH > cvH + 80 && wW >= 400,
    { wW, wH, cvH });

  // 导出图里也要带色阶图例（解码后检查右下角区域有彩色像素）
  const legendInPng = await page.evaluate(async () => {
    const card = (window.WM.currentCards || [])[0];
    if (!card || typeof card.composite !== 'function') return null;
    const url = card.composite();
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx2 = c.getContext('2d');
    cx2.drawImage(img, 0, 0);
    const d = cx2.getImageData(Math.max(0, img.width - 220), Math.max(0, img.height - 420), 200, 300).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) colored++;
    }
    return { w: img.width, h: img.height, colored: colored };
  });
  ok('S33 导出 PNG 里也包含右下角色阶图例', !!legendInPng && legendInPng.colored > 400, legendInPng);

  /* -------- S34 全量网格两个 TAB 可独立切换 -------- */
  const tabState = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.WM.api.setView('gallery');
    window.WM.api.setGalleryTab('line');
    await wait();
    const line = { tab: window.WM.api.getState().galleryTab, maps: document.querySelectorAll('.grid-map .card-wafer').length, lines: document.querySelectorAll('.grid-profile .card-chart').length };
    window.WM.api.setGalleryTab('map');
    await new Promise((r) => setTimeout(r, 400));
    const map = { tab: window.WM.api.getState().galleryTab, maps: document.querySelectorAll('.grid-map .card-wafer').length, lines: document.querySelectorAll('.grid-profile .card-chart').length };
    return { line: line, map: map };
  });
  ok('S34 TAB 切换：LineProfile 只显示折线，WaferMap 只显示地图',
    tabState.line.tab === 'line' && tabState.line.maps === 0 && tabState.line.lines === 10 &&
    tabState.map.tab === 'map' && tabState.map.maps === 10 && tabState.map.lines === 0, tabState);

  /* -------- S35 统计柱状图 Y 轴贴合数据（不再从 0 起） -------- */
  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(900);
  const barAxis = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#viewRoot .card-chart')].find((c) => /Mean 对比/.test(c.querySelector('.ct').textContent));
    if (!card) return null;
    const inst = window.echarts.getInstanceByDom(card.querySelector('.chart-box'));
    const opt = inst.getOption();
    return { min: opt.yAxis[0].min, max: opt.yAxis[0].max };
  });
  ok('S35 Mean 柱状图 Y 轴不从 0 开始（柱子差异可见）',
    !!barAxis && barAxis.min > 50 && barAxis.min < barAxis.max, barAxis);

  /* -------- S36 每个测点都画出数值标签（圆外也不漏） -------- */
  const labelCover = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.WM.api.setView('single');
    window.WM.api.setWafer({ labels: true, interp: true });
    await wait();
    const cv = document.querySelector('#viewRoot .wafer-canvas');
    const w = cv.__wafer;
    const outside = (w.lastLabels || []).filter((b) => {
      const cx = (b.x0 + b.x1) / 2 - w.geom.cx, cy = (b.y0 + b.y1) / 2 - w.geom.cy;
      return cx * cx + cy * cy > (w.geom.R - 3) * (w.geom.R - 3);
    }).length;
    return { labels: w.labelCount, points: window.WM.api.getState().points, outside: outside, g: w.geom };
  });
  ok('S36 每个测点都有数值标签（数量 = 测点数）',
    labelCover.labels === labelCover.points, labelCover);
  ok('S36 落在圆外的标签也存在（不被遗漏）', labelCover.outside >= 0, labelCover);

  /* -------- S37 插值格点 / 平滑 σ 可调 -------- */
  const interpUi = await page.evaluate(() => ({
    method: !!document.getElementById('selInterpMethod'),
    methodVal: document.getElementById('selInterpMethod') && document.getElementById('selInterpMethod').value,
    smoothDisabled: document.getElementById('selSmooth') ? document.getElementById('selSmooth').disabled : null,
    res: !!document.getElementById('selInterpRes'),
    smooth: !!document.getElementById('selSmooth'),
    resVal: document.getElementById('selInterpRes') && document.getElementById('selInterpRes').value,
    smoothVal: document.getElementById('selSmooth') && document.getElementById('selSmooth').value
  }));
  ok('S37 面板出现「插值方法 / 格点 / 平滑 σ」可调项',
    interpUi.method && interpUi.res && interpUi.smooth &&
    interpUi.methodVal === 'tps' && interpUi.resVal === '220' && interpUi.smoothVal === '0.7', interpUi);
  ok('S37 样条模式下 σ 置灰（避免调了没反应）', interpUi.smoothDisabled === true, interpUi);

  const smoothEffect = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const snap = () => document.querySelector('#viewRoot .wafer-canvas').toDataURL();
    const a = snap();
    // 切到高斯核，σ 才有意义
    const m = document.getElementById('selInterpMethod');
    m.value = 'gauss'; m.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    const g0 = snap();
    const sel = document.getElementById('selSmooth');
    sel.value = '1.3';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    const g1 = snap();
    m.value = 'tps'; m.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    return { methodChanged: a !== g0, sigmaChanged: g0 !== g1, backToTps: snap() !== g1 };
  });
  ok('S37 切插值方法 / 改 σ 都会重绘插值面',
    smoothEffect.methodChanged && smoothEffect.sigmaChanged && smoothEffect.backToTps, smoothEffect);

  /* -------- S38 箱线图按半径分环（合成数据 49 点 → 0/49/98/147 四环） -------- */
  const boxInfo = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.WM.api.setView('single');
    await wait();
    const card = [...document.querySelectorAll('#viewRoot .card-chart')].find((c) => /Boxplot/.test(c.querySelector('.ct').textContent));
    if (!card) return null;
    const inst = window.echarts.getInstanceByDom(card.querySelector('.chart-box'));
    const opt = inst.getOption();
    return {
      cats: opt.xAxis[0].data,
      type: opt.series[0].type,
      data: opt.series[0].data.length,
      sub: card.querySelector('.csub') ? card.querySelector('.csub').textContent : ''
    };
  });
  ok('S38 箱线图按半径分环（49 点 → 4 个环）',
    !!boxInfo && boxInfo.type === 'boxplot' && boxInfo.cats.length === 4 && boxInfo.data === 4, boxInfo);
  ok('S38 X 轴标签为半径（R 0 / R 49 / R 98 / R 147）',
    !!boxInfo && /R 0/.test(boxInfo.cats[0]) && /R 147/.test(boxInfo.cats[3]), boxInfo && boxInfo.cats);

  // 箱体必须完整落在 Y 轴范围内（旧实现按 [1] 取值，箱顶会被裁）
  const boxRange = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#viewRoot .card-chart')].find((c) => /Boxplot/.test(c.querySelector('.ct').textContent));
    if (!card) return null;
    const inst = window.echarts.getInstanceByDom(card.querySelector('.chart-box'));
    const opt = inst.getOption();
    const data = opt.series[0].data;
    var lo = Infinity, hi = -Infinity;
    data.forEach((d) => { lo = Math.min(lo, d[0]); hi = Math.max(hi, d[4]); });
    return { axisMin: opt.yAxis[0].min, axisMax: opt.yAxis[0].max, dataMin: lo, dataMax: hi };
  });
  ok('S38 箱体完整显示（Y 轴覆盖 min..max，箱顶不被裁）',
    !!boxRange && boxRange.axisMin <= boxRange.dataMin + 1e-6 && boxRange.axisMax >= boxRange.dataMax - 1e-6,
    boxRange);

  /* -------- S40 单位下拉（Å / nm） -------- */
  const unitUi = await page.evaluate(() => {
    const el = document.getElementById('selUnit');
    return { tag: el && el.tagName, value: el && el.value, opts: el ? [...el.options].map((o) => o.value) : [] };
  });
  ok('S40 单位是下拉框，选项为 Å / nm',
    unitUi.tag === 'SELECT' && unitUi.opts.join(',') === 'Å,nm' && unitUi.value === 'Å', unitUi);

  /* -------- S39 等高线开关 -------- */
  const contour = await page.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = () => document.querySelector('#viewRoot .wafer-canvas');
    const on = cv().toDataURL();
    document.getElementById('chkContour').click();
    await wait();
    const off = cv().toDataURL();
    document.getElementById('chkContour').click();
    await wait();
    return { changed: on !== off, restored: cv().toDataURL() === on, levels: window.WM.state.wafer.contourLevels };
  });
  ok('S39 等高线可开关、且关闭后画面变化', contour.changed && contour.restored, contour);

  /* -------- S24 导入 .xlsx（多工作表） -------- */
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures', 'multi_sheet.xlsx'));
  await page.waitForTimeout(1300);
  const x24 = await page.evaluate(() => {
    const st = window.WM.api.getState();
    const row = document.getElementById('sheetRow');
    return {
      src: st.srcName, sheet: st.sheet, sheets: st.sheetNames,
      points: st.points, cols: st.valueNames, mean: window.WM.api.getStat().mean,
      rowExists: !!row
    };
  });
  ok('S24 导入 .xlsx：自动选中数据工作表（跳过说明页与空表）', x24.sheet === 'Data' && x24.sheets.length === 3, x24);
  ok('S24 xlsx 解析出 49 点 × 10 列，列名正确',
    x24.points === 49 && x24.cols.length === 10 && x24.cols[0] === 'TK1', { p: x24.points, c: x24.cols });
  near('S24 xlsx 数值与 CSV 完全一致（TK1 Mean）', x24.mean, expTK1.mean, 5e-3);
  ok('S24 界面不再有「工作表」控件（自动选表）', x24.rowExists === false, x24);

  /* -------- S25 切到无数据的说明表：提示并回退 -------- */
  const x25 = await page.evaluate(() => {
    window.WM.api.selectSheet('Info');            // 只有说明文字的表
    return { sheet: window.WM.api.getState().sheet, points: window.WM.api.getState().points };
  });
  ok('S25 切到无数据工作表：不破坏当前数据集', x25.sheet === 'Data' && x25.points === 49, x25);

  /* -------- S26 单工作表 xlsx：隐藏工作表下拉 -------- */
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures', 'single_sheet.xlsx'));
  await page.waitForTimeout(1100);
  const x26 = await page.evaluate(() => ({
    s: window.WM.api.getState(),
    hidden: !document.getElementById('sheetRow')   // 控件已移除
  }));
  ok('S26 单工作表 xlsx：数据正确且无工作表控件',
    x26.s.points === 49 && x26.s.sheet === 'Data' && x26.hidden === true, { h: x26.hidden, p: x26.s.points });

  /* -------- S27 顶部报告标题行自动跳过 -------- */
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures', 'title_row.xlsx'));
  await page.waitForTimeout(1100);
  const x27 = await page.evaluate(() => ({ s: window.WM.api.getState(), mean: window.WM.api.getStat().mean }));
  ok('S27 Excel 顶部标题行被自动跳过（列名为 X/Y/TK…）',
    x27.s.valueNames[0] === 'TK1' && x27.s.points === 49, x27.s.valueNames);
  near('S27 跳过标题行后数值仍正确', x27.mean, expTK1.mean, 5e-3);

  /* -------- S28 xlsx 数据可正常导出 -------- */
  {
    const xlPath = path.join(DL, 'xlsx-stats.csv');
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnExportCSV')]);
    await d.saveAs(xlPath);
    const txt = fs.readFileSync(xlPath, 'utf8').replace(/^\ufeff/, '').trim().split(/\r?\n/);
    ok('S28 由 xlsx 载入的数据可导出统计 CSV（12 行）', txt.length === 12 && txt[1].startsWith('TK1'), txt.length);
  }

  /* -------- S21 无控制台报错 -------- */
  ok('S21 全程零 pageerror / console.error', errors.length === 0, errors);

  console.log(log.join('\n'));
  console.log('\n' + (pass === total ? 'PASS ' : 'FAIL ') + pass + ' / ' + total);
  await browser.close();
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
