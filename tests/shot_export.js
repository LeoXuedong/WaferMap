'use strict';
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
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btnExportAll')]);
  const out = path.join(DL, 'all-composite.png');
  await d.saveAs(out);
  const b = fs.readFileSync(out);
  console.log('composite:', b.readUInt32BE(16), 'x', b.readUInt32BE(20), b.length, 'bytes');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
