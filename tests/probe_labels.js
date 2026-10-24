'use strict';
const path = require('path');
const { launch, openApp } = require('./helpers/launch');
const APP = path.resolve(__dirname, '..', 'index.html');
const DATA = require('./helpers/datafile')();
// 换自己的数据：export WM_DATA=/path/to/your.xlsx
(async () => {
  const { browser } = await launch();
  const { page } = await openApp(browser, APP);
  await page.setInputFiles('#fileInput', DATA);
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => {
    const cv = document.querySelector('#viewRoot .wafer-canvas');
    const w = cv.__wafer;
    return {
      labelCount: w.labelCount,
      lastLabels: w.lastLabels,
      points: window.WM.api.getState().points,
      g: { w: w.geom.w, h: w.geom.h, R: w.geom.R, cx: w.geom.cx, cy: w.geom.cy }
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
