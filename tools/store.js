/*
 * Chrome Web Store screenshots, 1280×800, in English and Russian.
 * Seeds demo data with made-up channel names, captures the popup at 2× and frames it
 * with a headline. Output: tools/out/store/<lang>/<n>-<name>.png
 * Run: npm run store
 */
const fs = require('fs');
const path = require('path');
const { launchWithExtension } = require('./lib');

const OUT = path.join(__dirname, 'out', 'store');

const COPY = {
  en: {
    overview: ['Channel points collect themselves', 'Glint claims the bonus chest, moments and drops while a stream is open, even in a background tab.'],
    history: ['Everything you got, in one place', 'Points, moments and drops by day, with a filter by type.'],
    settings: ['You decide what runs', 'Pick the channels to collect on, and switch off any automatic feature.'],
    privacy: ['No servers, no analytics', 'Your stats stay in your browser. Glint sends nothing anywhere.'],
    moment: 'First win of the season', drop: 'Golden crate'
  },
  ru: {
    overview: ['Баллы канала собираются сами', 'Glint забирает бонусный сундук, моменты и дропы, пока открыт стрим, даже в фоновой вкладке.'],
    history: ['Всё собранное в одном месте', 'Баллы, моменты и дропы по дням, с фильтром по типу.'],
    settings: ['Вы решаете, что работает', 'Выберите каналы для сбора, а любую автоматическую функцию можно выключить.'],
    privacy: ['Без серверов и аналитики', 'Статистика хранится только в вашем браузере. Glint никуда ничего не отправляет.'],
    moment: 'Первая победа сезона', drop: 'Золотой ящик'
  }
};

// [name, popup tab, color scheme, scroll the settings panel to the channel list]
const SHOTS = [
  ['overview', 'overview', 'dark'],
  ['history', 'history', 'dark'],
  ['settings', 'settings', 'dark'],
  ['privacy', 'overview', 'light']
];

async function seed(sw, copy) {
  await sw.evaluate(async ({ moment, drop }) => {
    const stats = GLINT.emptyStats();
    const day = n => GLINT.dayKey(Date.now() - n * 864e5);
    [960, 1420, 380, 2150, 1180, 1760, 1240].forEach((points, i) => {
      stats.days[day(6 - i)] = { points, moments: i % 3 === 0 ? 1 : 0, drops: i === 4 ? 1 : 0 };
      stats.total.points += points;
    });
    stats.total.moments = 3;
    stats.total.drops = 1;
    const now = Date.now();
    Object.assign(stats.channels, {
      nightowl_plays: { points: 4820, moments: 2, drops: 0, last: now },
      lunatide: { points: 3150, moments: 1, drops: 0, last: now },
      brassfox: { points: 1960, moments: 0, drops: 0, last: now },
      quietriver: { points: 870, moments: 0, drops: 0, last: now }
    });
    const ago = min => now - min * 60e3;
    const history = [
      { kind: 'points', channel: 'nightowl_plays', amount: 50, at: ago(4) },
      { kind: 'moments', channel: 'nightowl_plays', amount: 1, title: moment, at: ago(19) },
      { kind: 'points', channel: 'lunatide', amount: 50, at: ago(36) },
      { kind: 'points', channel: 'nightowl_plays', amount: 50, at: ago(51) },
      { kind: 'points', channel: 'lunatide', amount: 50, at: ago(67) },
      { kind: 'drops', channel: '', amount: 1, title: drop, at: ago(60 * 26) },
      { kind: 'points', channel: 'brassfox', amount: 50, at: ago(60 * 27) },
      { kind: 'points', channel: 'quietriver', amount: 50, at: ago(60 * 28) }
    ].map(h => ({ approx: false, title: '', ...h }));
    await chrome.storage.local.set({ stats, history });
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, channelMode: 'only', channelList: ['nightowl_plays', 'lunatide', 'brassfox'] } });
  }, { moment: copy.moment, drop: copy.drop });
}

async function popupShot(ctx, id, tab, scheme) {
  const p = await ctx.newPage();
  await p.emulateMedia({ colorScheme: scheme });
  await p.setViewportSize({ width: 720, height: 1160 });
  await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await p.addStyleTag({ content: 'html { zoom: 2; }' });
  await p.click(`#tab-${tab}`);
  await p.waitForTimeout(400);
  if (tab === 'overview') await p.hover('.chart .col:nth-of-type(6) .hit').catch(() => {});
  if (tab === 'settings') await p.evaluate(() => {
    // scrolls <main> to the channel list, but also the page itself: undo the latter
    document.querySelector('#channelsHead').scrollIntoView({ block: 'start' });
    document.scrollingElement.scrollTop = 0;
    document.querySelector('main').scrollTop -= 8;
  });
  await p.waitForTimeout(200);
  const png = await p.screenshot();
  await p.close();
  return png.toString('base64');
}

function frame(img, [title, sub], scheme) {
  const dark = scheme === 'dark';
  const c = dark
    ? { bg: '#0F1F1D', glow: 'rgba(217,164,65,.22)', ink: '#ECE7D9', ink2: '#A9BBB5', ring: 'rgba(217,164,65,.35)', shadow: 'rgba(2,10,9,.6)' }
    : { bg: '#E4ECE8', glow: 'rgba(200,146,46,.25)', ink: '#10302B', ink2: '#45605A', ring: 'rgba(16,48,43,.12)', shadow: 'rgba(16,48,43,.25)' };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body {
      width: 1280px; height: 800px; overflow: hidden;
      display: grid; grid-template-columns: 1fr 440px; align-items: center; gap: 72px;
      padding: 0 120px 0 110px;
      background: radial-gradient(640px 520px at 78% 50%, ${c.glow}, transparent 70%), ${c.bg};
      color: ${c.ink}; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; font-size: 24px; font-weight: 700; }
    .brand svg { width: 40px; height: 40px; }
    h1 { font-size: 54px; line-height: 1.08; font-weight: 750; letter-spacing: -0.02em; text-wrap: balance; }
    p { margin-top: 22px; max-width: 30ch; font-size: 22px; line-height: 1.45; color: ${c.ink2}; text-wrap: pretty; }
    img {
      width: 400px; height: auto; justify-self: center; border-radius: 22px;
      box-shadow: 0 0 0 1px ${c.ring}, 0 40px 90px ${c.shadow};
    }
  </style></head><body>
    <div>
      <div class="brand"><svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="#D9A441"/>
        <circle cx="14" cy="14" r="10.5" fill="none" stroke="#F3D58B"/>
        <path d="M14 6.5l1.8 4.6 4.9.4-3.8 3.1 1.2 4.8L14 16.7l-4.1 2.7 1.2-4.8-3.8-3.1 4.9-.4z" fill="#10201F"/></svg>Glint</div>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
    <img src="data:image/png;base64,${img}" alt="">
  </body></html>`;
}

(async () => {
  for (const lang of Object.keys(COPY)) {
    const copy = COPY[lang];
    const { ctx, sw, id } = await launchWithExtension({ lang });
    // a couple of open "streams" so the popup's status line has something to show
    await ctx.route('https://www.twitch.tv/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stream</title>' }));
    for (const ch of ['nightowl_plays', 'lunatide']) await (await ctx.newPage()).goto(`https://www.twitch.tv/${ch}`);
    await seed(sw, copy);

    const dir = path.join(OUT, lang);
    fs.mkdirSync(dir, { recursive: true });
    const canvas = await ctx.newPage();
    await canvas.setViewportSize({ width: 1280, height: 800 });
    for (const [i, [name, tab, scheme]] of SHOTS.entries()) {
      const img = await popupShot(ctx, id, tab, scheme);
      await canvas.setContent(frame(img, copy[name], scheme));
      const file = path.join(dir, `${i + 1}-${name}.png`);
      await canvas.screenshot({ path: file });
      console.log(file);
    }
    await ctx.close();
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
