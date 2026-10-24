'use strict';
/* ==========================================================================
   生成 xlsx 测试夹具 —— 数据全部来自 tests/helpers/synthetic.js（合成，确定性）
   不含任何真实测量值。
     多工作表 / 单工作表 / 标题行 / 25 点机台式文件
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const XLSX = require(path.resolve(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
const synth = require('./helpers/synthetic');

const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

/* 合成 CSV → 二维数组（数值化） */
function synthRows() {
  return synth
    .toCsv()
    .trim()
    .split('\n')
    .map((line) =>
      line.split(',').map((c) => {
        const n = Number(c);
        return c.trim() !== '' && isFinite(n) ? n : c;
      })
    );
}

function writeBook(file, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, aoa]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log('written', file);
}

const rows = synthRows();          // 第 0 行是表头
const dataRows = rows.slice(1);

/* 1) 多工作表：Info（说明页）+ Data（数据）+ Empty（空表） */
writeBook('multi_sheet.xlsx', [
  ['Info', [['Wafer Thickness Report'], ['Source', 'synthetic (generated)'], ['Points', dataRows.length], ['Columns', rows[0].length - 2]]],
  ['Data', rows],
  ['Empty', []]
]);

/* 2) 单工作表 */
writeBook('single_sheet.xlsx', [['Data', rows]]);

/* 3) 顶部带标题行（自动跳过） */
writeBook('title_row.xlsx', [
  ['Data', [['Wafer Thickness Measurement Report']].concat([rows[0]]).concat(dataRows)]
]);

/* 4) 25 点机台式文件：1 + 8(R73.5) + 16(R147)，列 SIN / Degree / Theta */
function machineRows() {
  const pts = [[0, 0]];
  [[8, 73.5], [16, 147]].forEach(([n, r]) => {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + (r === 147 ? 0.1 : 0);
      pts.push([+(r * Math.cos(a)).toFixed(1), +(r * Math.sin(a)).toFixed(1)]);
    }
  });
  const head = ['X', 'Y', 'SIN', 'Degree', 'Theta'];
  const body = pts.map(([x, y], i) => {
    const t = i / pts.length;
    return [
      x,
      y,
      +(208 + 2.4 * Math.sin(t * 6.28 + 0.4) + (Math.abs(x) + Math.abs(y)) / 400).toFixed(3),
      +(1.5 + 0.22 * Math.cos(t * 3.14)).toFixed(3),
      +(0.32 + 0.05 * Math.sin(t * 9.42)).toFixed(3)
    ];
  });
  return [head].concat(body);
}
writeBook('thk25.xlsx', [['Sheet2', machineRows()]]);

console.log('done:', fs.readdirSync(OUT).join(', '));
