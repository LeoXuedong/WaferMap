'use strict';
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');
const APP = path.resolve(__dirname, '..', 'index.html');
(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);
  await page.waitForTimeout(600);
  const SH = path.join(__dirname, 'shots');
  fs.mkdirSync(SH, { recursive: true });
  const f = path.join(SH, 'empty-start.png');
  await page.screenshot({ path: f });
  const info = await page.evaluate(() => ({
    points: window.WM.api.getState().points,
    empty: (document.querySelector('#viewRoot .empty-t') || {}).textContent,
    dsinfo: (document.getElementById('dsinfo') || {}).textContent,
    status: (document.getElementById('statusbar') || {}).textContent
  }));
  console.log(JSON.stringify(info));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
