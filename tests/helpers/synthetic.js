'use strict';
/* ==========================================================================
   确定性合成测试数据（不含任何真实测量值）
   49 点 × 10 列，四环布局：中心 1 + R49 8 + R98 16 + R147 24
   同一种子 → 同一份数据，保证断言可复现
   ========================================================================== */

const NAMES = Array.from({ length: 10 }, (_, i) => 'TK' + (i + 1));

/** 线性同余伪随机（确定性） */
function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 49 点标准晶圆布局：1 + 8 + 16 + 24 */
function makePoints() {
  const pts = [[0, 0]];
  [[8, 49], [16, 98], [24, 147]].forEach(([n, r]) => {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + (r === 98 ? 0.13 : 0) + (r === 147 ? 0.07 : 0);
      pts.push([+(r * Math.cos(a)).toFixed(1), +(r * Math.sin(a)).toFixed(1)]);
    }
  });
  return pts;
}

/** 膜厚：径向趋势 + 角度调制 + 确定性噪声 */
function makeValues(xs, ys) {
  const out = [];
  for (let c = 0; c < NAMES.length; c++) {
    const rnd = lcg(1000 + c * 97);
    const col = xs.map((x, i) => {
      const y = ys[i];
      const r = Math.sqrt(x * x + y * y) / 147;
      const a = Math.atan2(y, x);
      const base = 100 + 7.5 * Math.pow(r, 1.5);          // 中心低、边缘高
      const wave = 2.4 * Math.sin(3 * a + c * 0.6) * r;   // 角向起伏
      const noise = (rnd() - 0.5) * 2.2;
      return +(base + wave + noise).toFixed(3);
    });
    out.push(col);
  }
  return out;
}

function toCsv() {
  const pts = makePoints();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cols = makeValues(xs, ys);
  const lines = ['X,Y,' + NAMES.join(',')];
  for (let i = 0; i < pts.length; i++) {
    lines.push([xs[i], ys[i]].concat(cols.map((c) => c[i])).join(','));
  }
  return lines.join('\n') + '\n';
}

module.exports = { toCsv, makePoints, makeValues, NAMES };
