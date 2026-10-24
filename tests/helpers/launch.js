'use strict';
/* 解析 Playwright / Chromium 并以 file:// 打开 index.html */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

/** 本机 Chromium 候选：home 推导，跨用户可移植；找不到则回退 Playwright 自带浏览器 */
const HOME_N = os.homedir().replace(/\\/g, '/');

const PW_CANDIDATES = [
  'playwright',
  HOME_N + '/AppData/Local/hermes/hermes-agent/node_modules/playwright',
  HOME_N + '/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
  'playwright-core'
];
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  HOME_N + '/AppData/Local/hermes/tools/chromium-1208/chrome-win64/chrome.exe',
  HOME_N + '/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  HOME_N + '/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  HOME_N + '/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }

function resolvePlaywright() {
  const tried = [];
  const list = PW_CANDIDATES.slice();
  if (process.env.PLAYWRIGHT_PATH) list.push(process.env.PLAYWRIGHT_PATH);
  for (const c of list) {
    tried.push(c);
    try {
      const m = require(c);
      if (m && m.chromium) return m;
    } catch (e) { }
  }
  throw new Error('找不到 Playwright，已尝试：\n  ' + tried.join('\n  '));
}

function resolveChromium() {
  const env = process.env.PLAYWRIGHT_CHROMIUM;
  if (env && exists(env)) return env;
  for (const p of CHROME_CANDIDATES) if (exists(p)) return p;
  return null;
}

async function launch(opts) {
  const pw = resolvePlaywright();
  const exe = resolveChromium();
  const o = opts || {};
  const launchOpts = { headless: o.headless !== false, args: ['--allow-file-access-from-files'] };
  if (exe) launchOpts.executablePath = exe;
  const browser = await pw.chromium.launch(launchOpts);
  return { browser, pw, exe };
}

async function openApp(browser, indexPath, opts) {
  const o = opts || {};
  const href = pathToFileURL(path.resolve(indexPath)).href;
  const page = await browser.newPage({ viewport: o.viewport || { width: 1680, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + String(m.text()).slice(0, 300)); });
  await page.goto(href, { timeout: 30000 });
  await page.waitForFunction(() => !!(window.WM && window.WM.ready), null, { timeout: 30000 });
  return { page, errors };
}

module.exports = { resolvePlaywright, resolveChromium, launch, openApp };
