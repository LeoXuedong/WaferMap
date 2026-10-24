'use strict';
/* 截图脚本：默认用合成数据；设置 WM_DATA=<你的文件> 可换成自己的数据 */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const DATA = require('./helpers/datafile')();
// 换自己的数据：export WM_DATA=/path/to/your.xlsx
const DL = path.join(__dirname, 'dl_real');
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.setInputFiles('#fileInput', DATA);
  await page.waitForTimeout(1500);

  const st = await page.evaluate(() => {
    const s = window.WM.api.getState();
    return { sheet: s.sheet, points: s.points, cols: s.valueNames, unit: s.unit, radius: s.waferRadius };
  });
  console.log('state:', JSON.stringify(st));

  await page.screenshot({ path: path.join(__dirname, 'shots', 'real-single.png') });

  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.card-wafer .mini')]);
  const out = path.join(DL, 'real-wafer.png');
  await d.saveAs(out);
  const b = fs.readFileSync(out);
  console.log('wafer PNG:', b.readUInt32BE(16), 'x', b.readUInt32BE(20));

  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'real-gallery.png') });

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
