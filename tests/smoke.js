'use strict';
/* 冒烟：加载 → 断言零报错 → 三视图各截一张图 */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const HERE = __dirname;
const APP = path.resolve(HERE, '..', 'index.html');
const SHOT = path.join(HERE, 'shots');
fs.mkdirSync(SHOT, { recursive: true });

(async () => {
  const { browser, exe } = await launch();
  console.log('chromium:', exe || '(playwright default)');
  const { page, errors } = await openApp(browser, APP);

  const state = await page.evaluate(() => window.WM.api.getState());
  console.log('state:', JSON.stringify({ points: state.points, cols: state.valueNames.length, view: state.view, radius: state.waferRadius }));

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT, '01-single.png') });

  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOT, '02-gallery.png') });

  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT, '03-stats.png') });

  const cards = await page.evaluate(() => window.WM.api.currentCards());
  console.log('cards(stats view):', JSON.stringify(cards));

  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(600);
  const ext = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /^https?:/.test(r.name)).length);
  console.log('external requests:', ext);
  console.log('errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
