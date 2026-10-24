'use strict';
/* 探针：xlsx 导入是否可用 */
const path = require('path');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const XLSX_MULTI = path.join(__dirname, 'fixtures', 'multi_sheet.xlsx');
const XLSX_ONE = path.join(__dirname, 'fixtures', 'single_sheet.xlsx');

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);

  const hasXlsx = await page.evaluate(() => typeof window.XLSX === 'object' && typeof window.XLSX.read === 'function');
  console.log('XLSX loaded:', hasXlsx);

  await page.setInputFiles('#fileInput', XLSX_MULTI);
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const s = window.WM.api.getState();
    return {
      src: s.srcName, sheet: s.sheet, sheets: s.sheetNames, points: s.points,
      cols: s.valueNames, mean: window.WM.api.getStat(0).mean,
      sheetRowHidden: document.getElementById('sheetRow').hidden,
      sheetOptions: [...document.querySelectorAll('#selSheet option')].map((o) => o.value)
    };
  });
  console.log('multi:', JSON.stringify(st));

  // 切到 Info 表（应报错或切走），再切回 Data
  await page.selectOption('#selSheet', 'Data');
  await page.waitForTimeout(600);

  await page.setInputFiles('#fileInput', XLSX_ONE);
  await page.waitForTimeout(1000);
  const st2 = await page.evaluate(() => {
    const s = window.WM.api.getState();
    return { sheet: s.sheet, sheets: s.sheetNames, points: s.points, cols: s.valueNames.length,
             sheetRowHidden: document.getElementById('sheetRow').hidden };
  });
  console.log('single:', JSON.stringify(st2));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
