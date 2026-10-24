'use strict';
/* 截图：开启「图表数值」后的 Lineplot / 直方图 */
const path = require('path');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('chkValues').click(); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'v1-values-on.png') });

  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'v2-values-stats.png') });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
