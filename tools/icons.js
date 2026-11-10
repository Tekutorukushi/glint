/* Renders icons/icon.svg to icon-16/32/48/128.png. Run: npm run icons */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('./lib');

const dir = path.resolve(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');

// Toolbar sizes (16, 32): the browser never draws the button icon larger than 16 px,
// so the coin fills almost the whole square, the dark outer ring (invisible on dark
// toolbars) becomes a thin outline, and the star is bigger. No sparkle or inner rim.
const toolbar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F3D58B"/>
      <stop offset="0.55" stop-color="#D9A441"/>
      <stop offset="1" stop-color="#A9761E"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="60" fill="url(#face)" stroke="#13302C" stroke-width="8"/>
  <path transform="translate(64 64) scale(1.38) translate(-64 -61)"
    d="M64 30l8.6 21.9 23.4 1.6-18.1 14.9 5.8 22.8L64 78.6 44.3 91.2l5.8-22.8L32 53.5l23.4-1.6z" fill="#13302C"/>
</svg>`;

(async () => {
  const b = await chromium.launch({ executablePath: findChromium() });
  for (const size of [16, 32, 48, 128]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const src = size <= 32 ? toolbar : svg;
    await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true });
    await p.close();
  }
  await b.close();
})();
