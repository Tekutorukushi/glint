/* Shared helpers for the dev tools: find Playwright's Chromium, launch it with the extension. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const EXT = path.resolve(__dirname, '..');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const sub of fs.readdirSync(`${base}/${d}`)) {
    const exe = `${base}/${d}/${sub}/chrome`;
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('Chromium not found: run "npx playwright install chromium" or set CHROMIUM_PATH');
}

/** Fresh profile with the extension loaded. Returns { ctx, sw, id }. */
async function launchWithExtension({ lang } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-profile-'));
  const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'];
  if (lang) args.push(`--lang=${lang}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(), headless: true, args, ...(lang ? { locale: lang } : {})
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: sw.url().split('/')[2] };
}

module.exports = { EXT, findChromium, launchWithExtension };
