'use strict';
/* 截图：导入 xlsx 后的界面（含工作表下拉） */
const path = require('path');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const XLSX_MULTI = path.join(__dirname, 'fixtures', 'multi_sheet.xlsx');

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.setInputFiles('#fileInput', XLSX_MULTI);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'x1-xlsx-single.png') });
  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'x2-xlsx-gallery.png') });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
