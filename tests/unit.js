'use strict';
/* 单元测试：core.js / stats.js 纯逻辑（Node + 假 window，不开浏览器）
   运行：node tests/unit.js      末行输出 PASS a / b */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = { window: {}, console, document: { createElement: () => ({ getContext: () => ({}) }) }, URL: {}, Blob: function () { } };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/core.js', 'js/stats.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const WM = sandbox.WM;

let pass = 0, total = 0;
const results = [];
function ok(name, cond, detail) {
  total++;
  if (cond) { pass++; results.push('  ok   ' + name); }
  else results.push('  FAIL ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
}
function eq(name, a, b, tol) {
  const same = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol) : a === b;
  ok(name, same, { got: a, want: b });
}
function near(name, a, b, tol) { ok(name, Math.abs(a - b) <= tol, { got: a, want: b, tol }); }

/* ---------- 1. CSV 解析 ---------- */
const csv1 = '\ufeffA,B,C\r\n1,2,3\r\n4,5,6\r\n\r\n';
const r1 = WM.parseCSV(csv1);
eq('CSV: 去 BOM + CRLF 行数', r1.length, 3);
eq('CSV: 首行首列', r1[0][0], 'A');
eq('CSV: 数值单元格', r1[2][2], '6');

const r2 = WM.parseCSV('a\tb\n1\t2\n');
eq('CSV: tab 分隔自动识别', r2[1][1], '2');

const r3 = WM.parseCSV('x,y\n"1,5",2\n');
eq('CSV: 引号内逗号', r3[1][0], '1,5');

const r4 = WM.parseCSV('x,y\n"he said ""hi""",2\n');
eq('CSV: 双引号转义', r4[1][0], 'he said "hi"');

eq('CSV: 分号分隔', WM.parseCSV('a;b;c\n1;2;3\n')[1][2], '3');

/* ---------- 2. 数据集构建 ---------- */
const synth = require('./helpers/synthetic');
const demoText = synth.toCsv();
const ds = WM.buildDataset(WM.parseCSV(demoText));
eq('dataset: 识别表头', ds.hasHeader, true);
eq('dataset: 行数', ds.rowCount, 49);
eq('dataset: X 列索引', ds.xCol, 0);
eq('dataset: Y 列索引', ds.yCol, 1);
eq('dataset: 膜厚列数', ds.valueCols.length, 10);
eq('dataset: 首个膜厚列名', ds.valueNames[0], 'TK1');

const pts = WM.makePoints(ds);
eq('points: 数量', pts.points.length, 49);
near('points: 第 1 点 X', pts.points[0].x, 0, 1e-9);
const firstRow = demoText.split(String.fromCharCode(10))[1].split(',');
near('points: 第 1 点 TK1 与源数据首行一致', pts.points[0].v[0], Number(firstRow[2]), 1e-9);

// 无表头 + 分号 + 少量列
const ds2 = WM.buildDataset(WM.parseCSV('0;0;1.5\n1;2;2.5\n3;4;3.5\n'));
eq('dataset: 无表头自动判定', ds2.hasHeader, false);
eq('dataset: 无表头列数', ds2.valueCols.length, 1);
eq('dataset: 无表头列名回退', ds2.names[2], 'C3');

// 尾部空行 / 缺少单元格：全列缺测的行被丢弃并计入 skipped；部分缺测的行保留
const ds3 = WM.buildDataset(WM.parseCSV('X,Y,V1,V2\n0,0,1,1\n1,1,,2\n2,2,,\n'));
const p3 = WM.makePoints(ds3);
eq('points: 部分缺测行保留、全缺测行丢弃', p3.points.length, 2);
eq('points: 丢弃行计数', p3.skipped, 1);
eq('points: 缺测值保留为 NaN', isNaN(p3.points[1].v[0]), true);
eq('points: 同行的有效值仍在', p3.points[1].v[1], 2);

/* ---------- 3. 统计 ---------- */
const st = WM.stat([1, 2, 3, 4]);
near('stat: mean', st.mean, 2.5, 1e-12);
near('stat: median(偶数)', st.median, 2.5, 1e-12);
near('stat: std 样本(n-1)', st.std, Math.sqrt(5 / 3), 1e-12);
near('stat: range', st.range, 3, 1e-12);
near('stat: nu%', st.nu, Math.sqrt(5 / 3) / 2.5 * 100, 1e-12);
eq('stat: n', st.n, 4);
near('stat: median(奇数)', WM.stat([5, 1, 9]).median, 5, 1e-12);
eq('stat: 含 NaN 时只统计有效值', WM.stat([1, NaN, 3, undefined, 'x']).n, 2);
eq('stat: 空输入 n=0', WM.stat([]).n, 0);
eq('stat: 单值 std=0', WM.stat([7]).std, 0);

const spec = { lsl: 92, usl: 108 };
const ins = WM.inSpec([90, 95, 100, 105, 110], spec);
eq('inSpec: 通过数', ins.pass, 3);
near('inSpec: 百分比', ins.pct, 60, 1e-12);
eq('inSpec: 未设规格返回 NaN', isNaN(WM.inSpec([1, 2], { lsl: NaN, usl: NaN }).pct), true);

const fit = WM.linfit([0, 1, 2, 3], [1, 3, 5, 7]);
near('linfit: 斜率', fit.b, 2, 1e-12);
near('linfit: 截距', fit.a, 1, 1e-12);
near('linfit: R²', fit.r2, 1, 1e-12);

const h = WM.histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
eq('hist: 箱数', h.length, 5);
eq('hist: 计数合计 = 样本数', h.reduce((a, b) => a + b.count, 0), 10);
near('hist: 首箱左界', h[0].x0, 1, 1e-12);

const rb = WM.radialBins([0, 5, 12, 18, 25], [10, 10, 20, 20, 30], 10);
eq('radialBins: 桶数', rb.length, 3);
near('radialBins: 首桶均值', rb[0].mean, 10, 1e-12);
near('radialBins: 桶中心半径', rb[0].r, 5, 1e-12);

/* ---------- 4. 色阶 ---------- */
const ramp = WM.makeRamp('viridis', false, 0);
const c0 = ramp(0), c1 = ramp(1);
eq('ramp: 起点=viridis #440154', c0.join(','), '68,1,84');
eq('ramp: 终点=viridis #fde725', c1.join(','), '253,231,37');
const rampR = WM.makeRamp('viridis', true, 0);
eq('ramp: 反向起点', rampR(0).join(','), '253,231,37');
const rampL = WM.makeRamp('viridis', false, 4);
eq('ramp: 4 级离散只产生 4 种颜色', new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map(t => rampL(t).join(','))).size, 4);
eq('ramp: 越界钳制', ramp(2).join(','), '253,231,37');
ok('cssGradient: 生成 90deg 渐变', /^linear-gradient\(90deg,rgb\(/.test(WM.cssGradient('jet', false)));

/* ---------- 5. 数值格式化 / 范围 ---------- */
eq('fmt: 固定小数位', WM.util.fmt(100.7034, 3), '100.703');
eq('fmt: 负零不显示 -0', WM.util.fmt(-0.0001, 3), '0.000');
eq('fmt: NaN → 破折号', WM.util.fmt(NaN, 2), '—');
eq('fmt: 字符串输入不崩', WM.util.fmt('abc', 2), '—');

const S = { scale: { domain: 'auto', min: NaN, max: NaN, name: 'viridis', reverse: false, levels: 0 }, globalRange: { min: 0, max: 100 } };
const d1 = WM.colorDomain(S, [10, 20, 30]);
eq('colorDomain: auto 用单图 min', d1.min, 10);
eq('colorDomain: auto 用单图 max', d1.max, 30);
S.scale.domain = 'global';
const d2 = WM.colorDomain(S, [10, 20, 30]);
eq('colorDomain: global 用全局范围', d2.max, 100);
S.scale.domain = 'manual'; S.scale.min = 50; S.scale.max = 60;
const d3 = WM.colorDomain(S, [10, 20, 30]);
eq('colorDomain: manual 优先', d3.min, 50);
eq('colorDomain: manual 上限', d3.max, 60);
near('toUnit: 中值映射 0.5', WM.toUnit(20, { min: 10, max: 30 }), 0.5, 1e-12);
eq('toUnit: 超界钳制到 1', WM.toUnit(99, { min: 10, max: 30 }), 1);

/* ---------- 汇总 ---------- */
console.log(results.join('\n'));
const line = (pass === total ? 'PASS ' : 'FAIL ') + pass + ' / ' + total;
console.log('\n' + line);
process.exit(pass === total ? 0 : 1);
