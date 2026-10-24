'use strict';
/* 生成交付前人工复核截图 */
const path = require('path');
const fs = require('fs');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');
const SHOT = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT, { recursive: true });

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP, { viewport: { width: 1680, height: 950 } });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT, 'a-single.png') });

  // 打开插值 + 数值标签 + 标记加大
  await page.evaluate(() => window.WM.api.setWafer({ size: 16 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT, 'b-single-signs.png') });

  // 规格判定 + 更多统计项
  await page.evaluate(() => { window.WM.api.setSpec(92, 108); window.WM.api.setStatsItems(['mean', 'median', 'std', 'min', 'max', 'range', 'nu', 'n', 'inspec']); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT, 'c-single-spec.png') });

  await page.evaluate(() => { window.WM.api.setSpec(NaN, NaN); window.WM.api.setStatsItems(['mean', 'median', 'std', 'range', 'nu']); window.WM.api.setWafer({ size: 13 }); });
  await page.waitForTimeout(400);

  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT, 'd-gallery.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => { document.getElementById('viewRoot').scrollTop = 400; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT, 'e-gallery-profile.png') });
  await page.evaluate(() => { document.getElementById('viewRoot').scrollTop = 0; });

  await page.evaluate(() => window.WM.api.setGalleryMode('hist'));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOT, 'f-gallery-hist.png') });
  await page.evaluate(() => { window.WM.api.setGalleryMode('profile'); window.WM.api.setProfileMerge(true); });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOT, 'f2-gallery-merged.png') });
  await page.evaluate(() => { window.WM.api.setProfileMerge(false); window.WM.api.setGalleryMode('all'); });
  await page.waitForTimeout(600);

  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT, 'g-stats.png') });

  // 1280 窄屏
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT, 'h-single-1280.png') });

  // 1920 宽屏
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT, 'i-single-1920.png') });

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
