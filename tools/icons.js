/* Renders icons/icon.svg to icon-16/32/48/128.png. Run: npm run icons */
const { chromium } = require('playwright-core');
const fs = require('fs');
const findChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const sub of fs.readdirSync(`${base}/${d}`)) {
    const exe = `${base}/${d}/${sub}/chrome`;
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('Chromium not found: run "npx playwright install chromium" or set CHROMIUM_PATH');
};
const exe = findChromium();
(async () => {
  const b = await chromium.launch({ executablePath: exe });
  const dir = require('path').resolve(__dirname, '..', 'icons');
  const svg = fs.readFileSync(dir + '/icon.svg', 'utf8');
  // small sizes: drop the sparkle and inner rim so the shape stays crisp
  const small = svg.replace(/<circle cx="64" cy="64" r="41"[^>]*\/>/, '').replace(/<path d="M98[^>]*\/>/, '');
  for (const size of [16, 32, 48, 128]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const src = size <= 32 ? small : svg;
    await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: `${dir}/icon-${size}.png`, omitBackground: true });
    await p.close();
  }
  await b.close();
})();
