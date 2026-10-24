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
    const g = w.geom;
    const cent = (w.lastLabels || []).map((b) => [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]);
    // 每个测点的屏幕坐标
    const pts = g.px.map((x, i) => [Math.round(x), Math.round(g.py[i])]);
    return { g: { w: g.w, h: g.h, R: g.R, cx: g.cx, cy: g.cy }, pts: pts, labels: cent, n: cent.length };
  });
  console.log('geom', JSON.stringify(r.g));
  console.log('点坐标:', JSON.stringify(r.pts));
  console.log('标签中心:', JSON.stringify(r.labels));
  await browser.close();
})();
