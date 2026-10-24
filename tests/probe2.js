'use strict';
/* 探针：表格溢出 / 导出下载 / 交互像素差异 */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const DL = path.join(__dirname, 'dl');
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(500);

  const t = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const tbl = document.querySelector('.stats-table');
    return {
      wrapW: wrap.clientWidth, wrapScrollW: wrap.scrollWidth,
      tblW: Math.round(tbl.getBoundingClientRect().width), tblScrollW: tbl.scrollWidth,
      wrapH: wrap.clientHeight, wrapScrollH: wrap.scrollHeight, rows: tbl.querySelectorAll('tbody tr').length
    };
  });
  console.log('table:', JSON.stringify(t));

  // 下载探针
  const tryDownload = async (label, fn) => {
    try {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), fn()]);
      const p = path.join(DL, d.suggestedFilename());
      await d.saveAs(p);
      console.log('download', label, '->', d.suggestedFilename(), fs.statSync(p).size, 'bytes');
    } catch (e) { console.log('download', label, 'FAILED', e.message); }
  };

  await tryDownload('statsCSV', () => page.click('#btnExportCSV'));
  await page.waitForTimeout(400);
  await tryDownload('dataCSV', () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#subbar .mini')].find(x => x.textContent.includes('导出数据'));
    b.click();
  }));
  await page.waitForTimeout(400);
  await tryDownload('compositeStats', () => page.click('#btnExportAll'));
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(600);
  await tryDownload('compositeSingle', () => page.click('#btnExportAll'));
  await page.waitForTimeout(2000);
  await tryDownload('cardPNG', () => page.click('#viewRoot .card-chart .mini'));

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
