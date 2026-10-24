'use strict';
/* 测试/截图用的数据文件路径：
   优先环境变量 WM_DATA（指向自己的 CSV/XLSX），否则用合成数据写一份临时 CSV。
   仓库内不含任何示例/真实测量数据。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const synth = require('./synthetic');

module.exports = function dataFile() {
  if (process.env.WM_DATA) return process.env.WM_DATA;
  const p = path.join(os.tmpdir(), 'wafermap-synthetic.csv');
  fs.writeFileSync(p, synth.toCsv(), 'utf8');
  return p;
};
