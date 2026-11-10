/*
 * End-to-end check: loads the extension into Chromium, serves fake twitch.tv pages
 * (bonus chest, drops inventory), verifies claims are recorded, then seeds demo data
 * and saves popup screenshots (dark/light) to tools/out/.
 * Run: npm test
 */
const fs = require('fs');
const path = require('path');
const { launchWithExtension } = require('./lib');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const channelPage = `<!doctype html><html><body><main>
<video id="v" muted loop src=""></video>
<div class="community-points-summary"><span data-test-selector="balance-string">1,200</span>
<button aria-label="Claim Bonus" id="bonus"><span class="claimable-bonus__icon">chest</span></button></div>
<script>
document.getElementById('bonus').addEventListener('click', e => {
  const s = document.querySelector('.community-points-summary');
  e.currentTarget.remove();
  setTimeout(() => { const p = document.createElement('div'); p.textContent = '+50'; s.appendChild(p);
    document.querySelector('[data-test-selector=balance-string]').textContent = '1,250'; window.__claimed = (window.__claimed||0)+1; }, 300);
});
window.__vis = () => document.visibilityState;
</script></main></body></html>`;
const invPage = `<!doctype html><html><body><main>
<div><img src=""><p>Golden Skin</p><button id="c">Claim Now</button></div>
<script>document.getElementById('c').onclick = e => { e.target.disabled = true; e.target.textContent = 'Claimed'; window.__drop = 1; };</script>
</main></body></html>`;
// bonus button that ignores clicks (e.g. Twitch changed something)
const stuckBonusPage = `<!doctype html><html><body><main>
<div class="community-points-summary"><span data-test-selector="balance-string">1,200</span>
<button aria-label="Claim Bonus" id="bonus" onclick="window.__clicks=(window.__clicks||0)+1"><span class="claimable-bonus__icon">chest</span></button></div>
</main></body></html>`;
const momentPage = works => `<!doctype html><html><body><main>
<div class="community-moment-callout"><p>Clutch 1v4</p><button id="m">Claim</button></div>
<script>document.getElementById('m').onclick = e => { window.__clicks=(window.__clicks||0)+1; ${works ? "e.target.closest('div').remove();" : ''} };</script>
</main></body></html>`;
// player error overlay that never goes away
const brokenPlayerPage = `<!doctype html><html><body><main>
<div class="content-overlay-gate"><button onclick="window.__gateClicks=(window.__gateClicks||0)+1">Try again</button></div>
</main></body></html>`;
// the bonus chest appears 4 s after load
const lateBonusPage = channelPage.replace('</script></main>', `
const late = document.getElementById('bonus'), box = late.parentElement;
late.remove();
setTimeout(() => box.appendChild(late), 4000);
</script></main>`);

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  ok || failed++;
};

(async () => {
  const { ctx, sw, id } = await launchWithExtension();
  const hits = {};
  await ctx.route('https://www.twitch.tv/**', route => {
    const u = new URL(route.request().url());
    hits[u.pathname] = (hits[u.pathname] || 0) + 1;
    const html = body => route.fulfill({ contentType: 'text/html', body });
    if (u.pathname.startsWith('/drops/inventory')) return html(invPage);
    if (u.pathname.startsWith('/stuckbonus')) return html(stuckBonusPage);
    if (u.pathname.startsWith('/momentok')) return html(momentPage(true));
    if (u.pathname.startsWith('/momentstuck')) return html(momentPage(false));
    if (u.pathname.startsWith('/brokenplayer')) return html(brokenPlayerPage);
    if (u.pathname.startsWith('/latebonus')) return html(lateBonusPage);
    return html(channelPage);
  });
  const swErr = []; sw.on('console', m => ['error', 'warning'].includes(m.type()) && swErr.push(m.text()));

  const tw = await ctx.newPage();
  const pageErr = []; tw.on('pageerror', e => pageErr.push(e.message)); tw.on('console', m => m.type() === 'error' && pageErr.push(m.text()));
  await tw.goto('https://www.twitch.tv/shroud');
  await tw.waitForTimeout(4500);
  console.log('bonus clicked:', await tw.evaluate(() => window.__claimed), 'visibility spoof:', await tw.evaluate(() => window.__vis()));
  await tw.screenshot({ path: out + '/toast.png', clip: { x: 0, y: 500, width: 420, height: 220 } });

  const inv = await ctx.newPage();
  await inv.goto('https://www.twitch.tv/drops/inventory');
  await inv.waitForTimeout(3000);
  console.log('drop clicked:', await inv.evaluate(() => window.__drop));

  // clicks that do nothing must not be recorded, and must not be retried every tick
  const stuck = await ctx.newPage();
  await stuck.goto('https://www.twitch.tv/stuckbonus');
  const mOk = await ctx.newPage();
  await mOk.goto('https://www.twitch.tv/momentok');
  const mStuck = await ctx.newPage();
  await mStuck.goto('https://www.twitch.tv/momentstuck');
  await stuck.waitForTimeout(14000);
  check('stuck bonus clicked once, then backs off', await stuck.evaluate(() => window.__clicks) === 1,
    `clicks=${await stuck.evaluate(() => window.__clicks)}`);
  check('stuck moment clicked once, then backs off', await mStuck.evaluate(() => window.__clicks) === 1,
    `clicks=${await mStuck.evaluate(() => window.__clicks)}`);

  // player error that never goes away: at most one reload per 10 minutes
  const seedRecover = reloadedAt => `if (window.name !== 'seeded') { window.name = 'seeded';
    const n = Date.now(); sessionStorage.setItem('glint-recover', JSON.stringify({ clicks: [n, n, n], reloadedAt: ${reloadedAt} })); }`;
  const brokenA = await ctx.newPage(); // just reloaded a minute ago: must not reload again
  await brokenA.addInitScript(seedRecover('Date.now() - 60e3'));
  await brokenA.goto('https://www.twitch.tv/brokenplayer/a');
  const brokenB = await ctx.newPage(); // never reloaded: reloads exactly once
  await brokenB.addInitScript(seedRecover('0'));
  await brokenB.goto('https://www.twitch.tv/brokenplayer/b');

  // channel list: an excluded channel is left alone
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, channelMode: 'except', channelList: ['skipme'] } });
  });
  const skip = await ctx.newPage();
  await skip.goto('https://www.twitch.tv/skipme');

  await brokenB.waitForTimeout(8000);
  check('excluded channel: bonus not clicked', await skip.evaluate(() => window.__claimed) === undefined);
  check('broken player, recent reload: clicks instead of reloading',
    hits['/brokenplayer/a'] === 1 && await brokenA.evaluate(() => window.__gateClicks) === 1, `loads=${hits['/brokenplayer/a']}`);
  check('broken player: reloads once, then clicks', hits['/brokenplayer/b'] === 2 &&
    await brokenB.evaluate(() => window.__gateClicks) === 1, `loads=${hits['/brokenplayer/b']}`);

  const st = await sw.evaluate(async () => chrome.storage.local.get(['stats', 'history']));
  console.log('stats total:', JSON.stringify(st.stats.total), 'channels:', Object.keys(st.stats.channels), 'history:', st.history.map(h => `${h.kind}:${h.amount}:${h.channel}:${h.title}`));
  const has = (kind, channel) => st.history.filter(h => h.kind === kind && h.channel === channel).length;
  check('bonus recorded with exact amount', st.history.some(h => h.kind === 'points' && h.channel === 'shroud' && h.amount === 50 && !h.approx));
  check('drop recorded', has('drops', '') === 1);
  check('working moment recorded once', has('moments', 'momentok') === 1);
  check('stuck bonus not recorded', has('points', 'stuckbonus') === 0);
  check('stuck moment not recorded', has('moments', 'momentstuck') === 0);
  console.log('badge:', await sw.evaluate(() => chrome.action.getBadgeText({})));
  const badges = await sw.evaluate(() => [0, 50, 999, 1000, 1999, 12400, 99999, 250000].map(shortNumber));
  check('badge text fits in 3 characters', JSON.stringify(badges) === '["0","50","999","1k","1k","12k","99k","99k"]', badges.join(','));

  // self-check: the stuck bonus shows up as a notice in the popup, and can be dismissed
  const health = await sw.evaluate(async () => (await chrome.storage.session.get('health')).health || {});
  check('stuck bonus reported', !!health['clickFailed:points'] && health['clickFailed:points'].channel === 'stuckbonus',
    Object.keys(health).join(','));
  {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.waitForTimeout(500);
    check('notice shown in popup', await p.isVisible('#notice'), await p.textContent('#noticeText'));
    await p.screenshot({ path: `${out}/notice.png` });
    const shown = Object.keys(health).length;
    await p.click('#noticeClose');
    await p.waitForTimeout(300);
    const left = await sw.evaluate(async () => Object.keys((await chrome.storage.session.get('health')).health || {}).length);
    check('notice dismissed', left === shown - 1, `left=${left}`);
    await p.close();
  }
  await sw.evaluate(() => chrome.storage.session.remove('health')); // clean popup screenshots

  // channel list in the popup: parsing what people type, adding, the empty "only" warning
  const parsed = await sw.evaluate(() => ['XQC', '@xqc', 'twitch.tv/xqc', 'https://www.twitch.tv/xqc/videos',
    'm.twitch.tv/xqc', 'twitch.tv', 'directory', 'a b'].map(GLINT.channelFromInput));
  check('channelFromInput', JSON.stringify(parsed) === JSON.stringify(['xqc', 'xqc', 'xqc', 'xqc', 'xqc', '', '', '']), parsed.join(','));
  const rules = await sw.evaluate(() => [
    GLINT.collectsOn('a', { channelMode: 'all', channelList: [] }),
    GLINT.collectsOn('a', { channelMode: 'only', channelList: ['a'] }),
    GLINT.collectsOn('b', { channelMode: 'only', channelList: ['a'] }),
    GLINT.collectsOn('a', { channelMode: 'except', channelList: ['a'] }),
    GLINT.collectsOn('b', { channelMode: 'except', channelList: ['a'] })]);
  check('collectsOn', JSON.stringify(rules) === '[true,true,false,false,true]', rules.join(','));
  {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-settings');
    await p.fill('#addChannelInput', 'https://www.twitch.tv/XQC');
    await p.press('#addChannelInput', 'Enter');
    await p.fill('#addChannelInput', 'not a channel!');
    await p.press('#addChannelInput', 'Enter');
    await p.waitForTimeout(300);
    const s = await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
    check('channel added from a link', JSON.stringify(s.channelList) === '["skipme","xqc"]', s.channelList.join(','));
    check('bad input marked invalid', await p.getAttribute('#addChannelInput', 'aria-invalid') === 'true');
    await p.click('#channelChips li:first-child button');
    await p.click('#channelChips li:first-child button');
    await p.click('#channelMode [data-mode="only"]');
    await p.waitForTimeout(300);
    check('empty "only" list warns', await p.getAttribute('#channelModeHint', 'class') === 'hint warn');
    await p.close();
    // a realistic list for the settings screenshots
    await sw.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, channelMode: 'except', channelList: ['jynxzi', 'zackrawrr'] } });
    });
  }

  // seed a week of data for screenshots
  await sw.evaluate(async () => {
    const { stats, history } = await chrome.storage.local.get(['stats', 'history']);
    const vals = [820, 1340, 0, 2150, 960, 1780];
    vals.forEach((v, i) => { const k = GLINT.dayKey(Date.now() - (6 - i) * 864e5); stats.days[k] = { points: v, moments: i % 3 === 0 ? 1 : 0, drops: 0 }; stats.total.points += v; });
    const today = GLINT.dayKey(); stats.days[today].points += 1150; stats.total.points += 1150; stats.days[today].moments = 2;
    Object.assign(stats.channels, { xqc: { points: 3820, moments: 1, drops: 0, last: Date.now() }, kaicenat: { points: 2410, last: Date.now() }, zackrawrr: { points: 1290, last: Date.now() }, jynxzi: { points: 640, last: Date.now() } });
    const now = Date.now();
    history.push({ kind: 'moments', channel: 'xqc', amount: 1, title: 'Clutch 1v4', at: now - 3600e3 },
      { kind: 'points', channel: 'kaicenat', amount: 50, at: now - 5400e3 }, { kind: 'points', channel: 'xqc', amount: 50, at: now - 864e5 - 7200e3 },
      { kind: 'drops', channel: '', amount: 1, title: 'Season Pass Crate', at: now - 864e5 - 9000e3 });
    await chrome.storage.local.set({ stats, history });
  });

  for (const scheme of ['dark', 'light']) {
    const p = await ctx.newPage({});
    await p.emulateMedia({ colorScheme: scheme });
    await p.setViewportSize({ width: 360, height: 580 });
    const perr = []; p.on('pageerror', e => perr.push(e.message));
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.waitForTimeout(800);
    await p.hover('.chart .col:nth-of-type(4) .hit').catch(() => {});
    await p.screenshot({ path: `${out}/popup-${scheme}.png` });
    await p.click('#tab-history'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/history-${scheme}.png` });
    await p.click('#tab-settings'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/settings-${scheme}.png` });
    await p.click('#tab-overview');
    console.log(scheme, 'popup errors:', perr);
    await p.close();
  }
  // channel detection shared by content, popup and background
  const names = await sw.evaluate(() => ['https://www.twitch.tv/Shroud', '/popout/xqc/chat', '/following', 'chrome-extension://abc/src/popup.html',
    '/directory/category/x', '/drops/inventory', '/moderator/kaicenat', '/'].map(GLINT.channelFromPath));
  check('channelFromPath', JSON.stringify(names) === JSON.stringify(['shroud', 'xqc', '', '', '', '', 'kaicenat', '']), names.join(','));

  // drops: empty inventory stretches the interval, a claim resets it
  const drops = await sw.evaluate(async () => {
    const minutesLeft = async () => Math.round(((await chrome.storage.local.get('dropsCheck')).dropsCheck.nextAt - Date.now()) / 60e3);
    const r = [];
    await inventoryChecked(0); r.push(await minutesLeft());
    await inventoryChecked(0); r.push(await minutesLeft());
    await inventoryChecked(0); r.push(await minutesLeft());
    const before = (await chrome.tabs.query({})).length;
    await checkDrops(); // within the wait: must not open a tab
    r.push((await chrome.tabs.query({})).length - before);
    await inventoryChecked(2); r.push(await minutesLeft());
    await chrome.storage.local.remove('dropsCheck');
    return r;
  });
  check('drops interval 30 → 60 → 60, skipped while waiting, reset to 15 after a claim',
    JSON.stringify(drops) === JSON.stringify([29, 59, 59, 0, 14]), drops.join(','));

  // retention: a flood of points must not push old drops out; daily totals kept for a year
  const kept = await sw.evaluate(async () => {
    const saved = await chrome.storage.local.get(['stats', 'history']);
    const now = Date.now();
    const history = [
      ...Array.from({ length: 300 }, (_, i) => ({ kind: 'points', channel: 'x', amount: 50, at: now - i * 60e3 })),
      ...Array.from({ length: 5 }, (_, i) => ({ kind: 'drops', channel: '', amount: 1, at: now - 864e5 * (30 + i) }))
    ];
    const stats = GLINT.emptyStats();
    for (let i = 1; i <= 400; i++) stats.days[GLINT.dayKey(now - i * 864e5)] = { points: 1, moments: 0, drops: 0 };
    await chrome.storage.local.set({ stats, history });
    await recordClaim({ kind: 'points', channel: 'x', amount: 50, at: now });
    const after = await chrome.storage.local.get(['stats', 'history']);
    await chrome.storage.local.set(saved);
    return [after.history.filter(h => h.kind === 'points').length, after.history.filter(h => h.kind === 'drops').length,
      Object.keys(after.stats.days).length];
  });
  check('history: 300 per kind, old drops survive; 366 days kept', JSON.stringify(kept) === '[300,5,366]', kept.join(','));

  // toggling master off propagates to page
  await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, enabled: false } }); });
  await tw.waitForTimeout(500);
  check('keepAlive off remembered for page.js', await tw.evaluate(() => localStorage.getItem('glint-keepalive')) === '0');
  console.log('badge when paused:', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));
  console.log('page errors:', pageErr, 'SW errors:', swErr);
  check('no page or service worker errors', !pageErr.length && !swErr.length);

  // extension updated while a Twitch tab is open: the old script must stop quietly
  // (it used to click and then throw on chrome.i18n). Must be last: it reloads the extension.
  await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, enabled: true } }); });
  const orphan = await ctx.newPage();
  const orphanErr = [];
  orphan.on('pageerror', e => orphanErr.push(e.message));
  await orphan.goto('https://www.twitch.tv/latebonus');
  await orphan.waitForTimeout(1500);
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await orphan.waitForTimeout(7000);
  check('after extension reload: old script stops without errors',
    !orphanErr.length && await orphan.evaluate(() => window.__claimed) === undefined, orphanErr.join('; '));
  await ctx.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
