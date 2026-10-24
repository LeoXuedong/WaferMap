'use strict';
/* 用 25 点合成夹具复核边缘标签与图例 */
const path = require('path');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures', 'thk25.xlsx'));
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(__dirname, 'shots', 't1-thk25.png') });
  const st = await page.evaluate(() => {
    const s = window.WM.api.getState();
    return { sheet: s.sheet, points: s.points, cols: s.valueNames, radius: s.waferRadius };
  });
  console.log('state:', JSON.stringify(st));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
