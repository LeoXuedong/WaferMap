'use strict';
/* 第 6 轮复核截图 + 导出 PNG（含统计条） */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const DL = path.join(__dirname, 'dl6');
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.waitForTimeout(700);

  await page.screenshot({ path: path.join(__dirname, 'shots', 'r6-single.png') });

  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'r6-gallery.png') });

  // 导出晶圆卡片 PNG（应含统计条）
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(900);
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.card-wafer .mini')]);
  const out = path.join(DL, 'wafer-card.png');
  await d.saveAs(out);
  const b = fs.readFileSync(out);
  console.log('wafer PNG:', b.readUInt32BE(16), 'x', b.readUInt32BE(20), b.length, 'bytes');

  // 全部导出（拼版）
  const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btnExportAll')]);
  const out2 = path.join(DL, 'all.png');
  await d2.saveAs(out2);
  const b2 = fs.readFileSync(out2);
  console.log('composite PNG:', b2.readUInt32BE(16), 'x', b2.readUInt32BE(20), b2.length, 'bytes');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
