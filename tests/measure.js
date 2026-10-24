'use strict';
/* 布局测量：检查是否溢出 / 裁切 / 卡片尺寸是否一致 */
const path = require('path');
const { launch, openApp } = require('./helpers/launch');

const APP = path.resolve(__dirname, '..', 'index.html');

(async () => {
  const { browser } = await launch();
  const { page, errors } = await openApp(browser, APP);

  const probe = async (label) => {
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        body: { sw: document.body.scrollWidth, sh: document.body.scrollHeight, cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight },
        shell: r('#shell'), view: r('#viewRoot'), status: r('#statusbar'),
        single: r('.single'), waferCard: r('.card-wafer'), waferWrap: r('.wafer-wrap'),
        strip: r('.stats-strip'), stack: r('.stack'), charts: [...document.querySelectorAll('.chart-box')].map(e => Math.round(e.getBoundingClientRect().height)),
        canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height)
      };
    });
    console.log('##', label, JSON.stringify(m));
  };

  await page.waitForTimeout(600);
  await probe('single');

  await page.evaluate(() => window.WM.api.setView('gallery'));
  await page.waitForTimeout(1200);
  await probe('gallery');
  const cardW = await page.evaluate(() => {
    const ws = [...document.querySelectorAll('.grid-map .card-wafer')].map(e => e.getBoundingClientRect().width);
    return { count: ws.length, min: Math.round(Math.min(...ws)), max: Math.round(Math.max(...ws)) };
  });
  console.log('gallery wafer card widths:', JSON.stringify(cardW));
  await page.screenshot({ path: path.join(__dirname, 'shots', '02-gallery.png'), fullPage: false });

  await page.evaluate(() => window.WM.api.setView('stats'));
  await page.waitForTimeout(700);
  await probe('stats');
  await page.screenshot({ path: path.join(__dirname, 'shots', '03-stats.png') });

  await page.evaluate(() => window.WM.api.setView('single'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'shots', '01-single.png') });

  console.log('errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
