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
// avatars: one in a channel link, one recognised by alt (sidebar-like), one from a foreign host
const avatarsHtml = `<a href="/shroud"><img src="https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png" alt="shroud"></a>
<img src="https://static-cdn.jtvnw.net/jtv_user_pictures/def-profile_image-50x50.jpeg" alt="KaiCenat">
<a href="/evil"><img src="https://evil.example/jtv_user_pictures/x-profile_image-70x70.png" alt="evil"></a>`;
const channelPage = `<!doctype html><html><body><main>
${avatarsHtml}
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
// a really playing video (canvas stream), to see what Glint does when it gets paused
const playingPage = `<!doctype html><html><body><main>
<canvas id="c" width="64" height="36"></canvas><video id="v" muted playsinline></video>
<script>
const c = document.getElementById('c'), x = c.getContext('2d'); let i = 0;
setInterval(() => { x.fillStyle = 'hsl(' + (i++ * 20 % 360) + ',50%,50%)'; x.fillRect(0, 0, 64, 36); }, 50);
const v = document.getElementById('v'); v.srcObject = c.captureStream(10); v.play();
</script></main></body></html>`;
// mature-content warning inside the player overlay container (as on Twitch)
const matureOverlayPage = `<!doctype html><html><body><main>
<div class="content-overlay-gate"><div class="content-overlay-gate__allow-pointers">
<button data-a-target="content-classification-gate-overlay-start-watching-button"
  onclick="window.__mature=(window.__mature||0)+1; this.remove()">Start watching</button></div></div>
</main></body></html>`;
// the real Twitch reload button (HTML from the live site), in a given language
const reloadButtonPage = label => `<!doctype html><html><body><main>
<div class="content-overlay-gate"><p>Error #2000</p>
<button class="ScCoreButton-sc-ocjdkq-0 iHfUmz" onclick="window.__reload=(window.__reload||0)+1"><div class="ScCoreButtonLabel-sc-s7h2b7-0 bfhate"><div class="Layout-sc-1xcs6mc-0 bPLZqY"><div class="ScCoreButtonIcon-sc-ypak37-0 cUiTmJ tw-core-button-icon"><div class="ScSvgWrapper-sc-wkgzod-0 cnGLHG tw-svg" data-a-selector="tw-core-button-icon"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5.999A9.985 9.985 0 0 0 12 2C6.477 2 2 6.477 2 12h2a8 8 0 0 1 14.93-4H14v2h8V2h-2v3.999ZM12 20a8 8 0 0 0 8-8h2c0 5.523-4.477 10-10 10a9.985 9.985 0 0 1-8-3.999V22H2v-8h8v2H5.07A7.997 7.997 0 0 0 12 20Z"></path></svg></div></div></div><div data-a-target="tw-core-button-label-text" class="Layout-sc-1xcs6mc-0 zdujK">${label}</div></div></button>
</div></main></body></html>`;
// another gate in the same overlay container with a single, non-retry button
const subOnlyPage = `<!doctype html><html><body><main>
<div class="content-overlay-gate"><p>This stream is for subscribers only</p>
<button onclick="window.__subscribe=(window.__subscribe||0)+1">Subscribe</button></div>
</main></body></html>`;
// a chest that every open copy of the channel can claim (stream + popout chat)
const sharedChestPage = `<!doctype html><html><body><main>
<div class="community-points-summary"><span data-test-selector="balance-string">1,000</span>
<button aria-label="Claim Bonus" id="bonus"><span class="claimable-bonus__icon">chest</span></button></div>
<script>
document.getElementById('bonus').addEventListener('click', e => {
  window.__claimed = (window.__claimed || 0) + 1;
  const b = e.currentTarget;
  setTimeout(() => { b.remove(); document.querySelector('[data-test-selector=balance-string]').textContent = '1,050'; }, 300);
});
</script></main></body></html>`;
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
  // Twitch's image server: any avatar is the extension icon; foreign hosts fail
  const avatarRequests = [];
  await ctx.route('https://static-cdn.jtvnw.net/**', route => {
    avatarRequests.push(route.request().url());
    route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-128.png')) });
  });
  const foreignFromPopup = [];
  await ctx.route('https://evil.example/**', route => {
    if (route.request().frame().url().startsWith('chrome-extension://')) foreignFromPopup.push(route.request().url());
    route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-16.png')) });
  });
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
    if (u.pathname.startsWith('/playing')) return html(playingPage);
    if (u.pathname.startsWith('/matureoverlay')) return html(matureOverlayPage);
    if (u.pathname.startsWith('/subonly')) return html(subOnlyPage);
    if (u.pathname.startsWith('/reloadru')) return html(reloadButtonPage('Щелкните здесь, чтобы перезагрузить проигрыватель'));
    if (u.pathname.startsWith('/reloadja')) return html(reloadButtonPage('ここをクリックしてプレーヤーを再読み込み'));
    if (u.pathname.startsWith('/dupe') || u.pathname.startsWith('/popout/dupe')) return html(sharedChestPage);
    return html(channelPage);
  });
  const swErr = []; sw.on('console', m => ['error', 'warning'].includes(m.type()) && swErr.push(m.text()));

  const tw = await ctx.newPage();
  const pageErr = []; tw.on('pageerror', e => pageErr.push(e.message)); tw.on('console', m => m.type() === 'error' && pageErr.push(m.text()));
  await tw.goto('https://www.twitch.tv/shroud');
  await tw.waitForTimeout(4500);
  console.log('bonus clicked:', await tw.evaluate(() => window.__claimed), 'visibility spoof:', await tw.evaluate(() => window.__vis()));
  await tw.screenshot({ path: out + '/toast.png', clip: { x: 0, y: 500, width: 420, height: 220 } });

  // toast position: picked in the popup on a little screen, applied to the open Twitch tab at once
  {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-settings');
    const startOn = await p.getAttribute('#toastPos [data-pos="bottom-left"]', 'aria-checked') === 'true';
    await p.click('#toastPos [data-pos="top-right"]');
    await p.waitForTimeout(300);
    const placed = await tw.evaluate(() => { const h = document.querySelector('glint-toasts'); return h && `${h.dataset.pos} ${h.style.right} ${h.style.top}`; });
    await p.locator('#toastPosRow').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/toast-position.png` });
    await p.focus('#toastPos [data-pos="top-right"]');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowLeft'); // over the empty centre to the left edge
    const byKeys = (await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.toastPosition));
    const name = await p.textContent('#toastPosName');
    await p.locator('input[data-setting="toasts"]').locator('xpath=..').click();
    const hiddenOff = await p.isHidden('#toastPosRow');
    await p.locator('input[data-setting="toasts"]').locator('xpath=..').click();
    await p.click('#toastPos [data-pos="bottom-left"]');
    await p.waitForTimeout(200);
    const back = await tw.evaluate(() => document.querySelector('glint-toasts').dataset.pos);
    await p.close();
    check('toast position: picked in the popup, moves the toasts, arrow keys, hidden when toasts are off',
      startOn && placed === 'top-right 16px 66px' && byKeys === 'left' && name === 'Middle left' && hiddenOff && back === 'bottom-left',
      `start=${startOn}, placed="${placed}", keys=${byKeys}, name="${name}", hiddenOff=${hiddenOff}, back=${back}`);
  }

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
    {
      const u = new URL(await p.getAttribute('#noticeReport', 'href'));
      const body = u.searchParams.get('body') || '';
      check('notice report link: prefilled GitHub issue with the problem code, no channel names',
        u.origin + u.pathname === 'https://github.com/Tekutorukushi/glint/issues/new' &&
        /self-check: \w+ \(\w+\)/.test(body) && body.includes('version: ') && !/stuckbonus/i.test(u.href),
        u.searchParams.get('title'));
    }
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
    // reopening the popup always starts on "Overview", whatever tab was open before
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-history');
    await p.reload();
    const sel = await p.getAttribute('#tab-overview', 'aria-selected');
    const histHidden = await p.isHidden('#panel-history');
    await p.close();
    check('popup reopens on Overview', sel === 'true' && histHidden, `overview selected=${sel}`);
  }
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

  // avatars: collected from Twitch pages, shown in the popup, only from Twitch's image server
  {
    const stored = await sw.evaluate(async () => (await chrome.storage.local.get('avatars')).avatars || {});
    check('avatars stored, resized to 70×70, foreign host ignored',
      stored.shroud?.url === 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png' &&
      stored.kaicenat?.url === 'https://static-cdn.jtvnw.net/jtv_user_pictures/def-profile_image-70x70.jpeg' && !stored.evil,
      Object.keys(stored).join(','));
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-overview');
    await p.waitForTimeout(600);
    const shown = await p.locator('.channel .avatar img.loaded').count();
    await p.click('#tab-history');
    await p.waitForTimeout(400);
    const inHistory = await p.locator('.event-pic .avatar img.loaded').count();
    await p.screenshot({ path: `${out}/history-avatars.png` });
    // a claim rebuilds the lists: already loaded avatars must appear at once, not fade in again
    await sw.evaluate(async () => { const { stats } = await chrome.storage.local.get('stats'); stats.total.points += 1; await chrome.storage.local.set({ stats }); });
    await p.click('#tab-overview');
    const blinking = await p.evaluate(() => [...document.querySelectorAll('.avatar img')]
      .filter(i => !(i.classList.contains('loaded') && i.classList.contains('instant'))).length);
    check('rebuilt lists show loaded avatars at once (no blink)', blinking === 0, `fading again: ${blinking}`);
    // a different picture for a channel seen today is ignored (at most one change a day)
    const kept = await sw.evaluate(async () => {
      recordAvatar('shroud', 'https://static-cdn.jtvnw.net/jtv_user_pictures/zzz-profile_image-70x70.png');
      await writeChain;
      return (await chrome.storage.local.get('avatars')).avatars.shroud.url;
    });
    check('avatar changes at most once a day', kept.includes('/abc-profile_image'), kept);
    // switched off: letters only, nothing loaded
    await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, avatars: false } }); });
    await p.waitForTimeout(300);
    const whenOff = await p.locator('.avatar img').count();
    await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, avatars: true } }); });
    await p.close();
    check('avatars shown in top channels and history, hidden when off', shown === 2 && inHistory >= 1 && whenOff === 0,
      `top=${shown}, history=${inHistory}, off=${whenOff}`);
    check('popup loads avatars only from Twitch image server', avatarRequests.length > 0 && !foreignFromPopup.length,
      `twitch=${avatarRequests.length}, foreign=${foreignFromPopup.length}`);
  }

  // chart period: 7 / 14 / 30 days, remembered between popup openings
  {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-overview');
    await p.waitForTimeout(300);
    const bars7 = await p.locator('.chart .col').count();
    await p.waitForTimeout(1000);
    check('no stale-tabs notice while all tabs run the current version', await p.isHidden('#staleNotice'));
    const totalShown = await p.textContent('#totalPoints');
    const totalStored = await sw.evaluate(async () => (await chrome.storage.local.get('stats')).stats.total.points);
    check('all-time total on the today card', totalShown === totalStored.toLocaleString('en-US'), `${totalShown} vs ${totalStored}`);
    const extra = await p.evaluate(() => ({
      text: document.querySelector('#totalExtra .sr-only').textContent,
      icons: [...document.querySelectorAll('#totalExtra .stat > span')].map(s => s.textContent).join('/')
    }));
    const totals = await sw.evaluate(async () => (await chrome.storage.local.get('stats')).stats.total);
    check('all-time moments and drops next to the total',
      extra.text === `Moments: ${totals.moments}, drops: ${totals.drops}` && extra.icons === `${totals.moments}/${totals.drops}`,
      `${extra.text} | ${extra.icons}`);
    await p.click('#chartRange [data-days="30"]');
    await p.waitForTimeout(300);
    await p.hover('.chart .col:nth-of-type(26) .hit');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/chart-30.png` });
    const bars30 = await p.locator('.chart .col').count();
    const labels30 = await p.locator('.chart .axis').count();
    await p.reload();
    await p.waitForTimeout(400);
    const remembered = await p.locator('.chart .col').count();
    const title = await p.textContent('#chartTitle');
    check('chart period 7 → 30, labels thinned, remembered',
      bars7 === 7 && bars30 === 30 && labels30 === 6 && remembered === 30 && title.includes('30'),
      `${bars7},${bars30},${labels30},${remembered},"${title}"`);
    await p.click('#chartRange [data-days="14"]');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/chart-14.png` });
    await p.click('#chartRange [data-days="7"]');
    await p.close();
  }

  // all channels: a long list with search, sorting, rows linking to Twitch; history search
  {
    const saved = await sw.evaluate(async () => {
      const saved = await chrome.storage.local.get('stats');
      const stats = structuredClone(saved.stats);
      const now = Date.now();
      for (let i = 0; i < 120; i++) {
        stats.channels[`viewer_${String(i).padStart(3, '0')}`] = { points: 10 + i, moments: i % 7 === 0 ? 1 : 0, drops: 0, last: now - i * 36e5 };
      }
      await chrome.storage.local.set({ stats });
      return saved;
    });
    const total = await sw.evaluate(async () => Object.values((await chrome.storage.local.get('stats')).stats.channels)
      .filter(c => (c.points || 0) > 0 || (c.moments || 0) > 0).length);
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-overview');
    await p.waitForTimeout(300);
    const noLink = await p.locator('#panel-overview .link-more, #allChannelsBtn').count() === 0;
    await p.click('#tab-channels');
    await p.waitForTimeout(300);
    const title = await p.textContent('#allChannelsTitle');
    // a fresh popup opens on Overview; switching to Channels builds the list
    await p.reload();
    await p.click('#tab-channels');
    await p.waitForTimeout(500);
    const rows = await p.locator('#allChannelList .ch-row').count();
    const firstByPoints = await p.textContent('#allChannelList li:first-child b');
    await p.screenshot({ path: `${out}/all-channels.png` });
    await p.fill('#channelSearch', 'viewer_11');
    const found = await p.locator('#allChannelList .ch-row').count(); // viewer_110..viewer_119
    await p.fill('#channelSearch', 'zzz');
    const nothing = await p.isVisible('#allChannelsEmpty');
    await p.fill('#channelSearch', '');
    await p.click('#channelSort [data-sort="name"]');
    const firstByName = await p.textContent('#allChannelList li:first-child b');
    await p.click('#channelSort [data-sort="recent"]');
    const firstRecent = await p.textContent('#allChannelList li:first-child b');
    const link = await p.$eval('#allChannelList li:first-child a.ch-row', a => [a.href, a.target, a.rel].join(' '));
    const linkOk = link === `https://www.twitch.tv/${firstRecent} _blank noopener`;
    await p.click('#tab-history');
    await p.waitForTimeout(400);
    const smalls = () => p.$$eval('#historyList .event small', els => els.map(e => e.textContent));
    await p.fill('#historySearch', 'KaiCenat');
    const byChannel = await smalls();
    await p.fill('#historySearch', 'crate');
    const byTitle = await smalls();
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/history-search.png` });
    await p.fill('#historySearch', 'zzz');
    const none = await p.isVisible('#historyNothing') && await p.isHidden('#historyEmpty') && (await smalls()).length === 0;
    await p.fill('#historySearch', '');
    const histOk = byChannel.length > 0 && byChannel.every(t => t.includes('kaicenat')) &&
      byTitle.length > 0 && byTitle.every(t => t.includes('Season Pass Crate')) && none;
    await p.close();
    await sw.evaluate(s => chrome.storage.local.set(s), saved);
    check('history search: by channel and by title', histOk, `channel=${byChannel.length}, title=${byTitle.length}, none=${none}`);
    check('channels tab: full list, search, 3 sorts, rows link to the channel',
      noLink && title.includes(String(total)) && rows === total && firstByPoints === 'xqc' && found === 10 && nothing &&
      firstByName === 'jynxzi' && firstRecent !== firstByName && linkOk,
      `noLink=${noLink}, title="${title}", rows=${rows}/${total}, top=${firstByPoints}, found=${found}, nothing=${nothing}, az=${firstByName}, recent=${firstRecent}, link="${link}"`);
  }

  // big numbers: from 100 000 on they are shortened (rounded down), exact value on hover
  {
    const saved = await sw.evaluate(async () => {
      const saved = await chrome.storage.local.get('stats');
      const stats = structuredClone(saved.stats);
      stats.days[GLINT.dayKey()].points = 99999;
      stats.total.points = 1234567;
      stats.channels.xqc.points = 123999;
      await chrome.storage.local.set({ stats });
      return saved;
    });
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-overview');
    await p.waitForTimeout(400);
    const got = await p.evaluate(() => [
      document.querySelector('#todayPoints').textContent,
      document.querySelector('#totalPoints').textContent, document.querySelector('#totalPoints').title,
      document.querySelector('.channel .num').textContent, document.querySelector('.channel .num').title]);
    await p.close();
    await sw.evaluate(s => chrome.storage.local.set(s), saved);
    check('big numbers shortened from 100 000, exact on hover',
      JSON.stringify(got) === JSON.stringify(['99,999', '1.2M', '1,234,567', '123K', '123,999']), got.join(' | '));
  }

  // support link at the end of settings opens Boosty in a new tab (served locally in the test)
  {
    await ctx.route('https://boosty.to/**', route => route.fulfill({ contentType: 'text/html', body: '<title>boosty</title>' }));
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-settings');
    await p.locator('#supportLink').scrollIntoViewIfNeeded();
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/support.png` });
    const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('#supportLink')]);
    await tab.waitForLoadState();
    const opened = tab.url();
    {
      const u = new URL(await p.getAttribute('#reportLink', 'href'));
      const body = u.searchParams.get('body') || '';
      check('report link: GitHub issue with version and browser, no self-check line',
        u.origin + u.pathname === 'https://github.com/Tekutorukushi/glint/issues/new' &&
        body.includes('version: ') && body.includes('browser: ') && !body.includes('self-check'), u.search.slice(0, 80));
    }
    const text = await p.textContent('#supportLink');
    await tab.close();
    await p.close();
    check('support link opens Boosty in a new tab', opened === 'https://boosty.to/tekutorukushi/donate' && text.includes('Boosty'),
      `${opened} | ${text.trim().replace(/\s+/g, ' ')}`);
  }

  // toggling a switch far down the settings must not scroll the popup page away
  {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-settings');
    const row = p.locator('input[data-setting="badge"]').locator('xpath=..');
    await row.scrollIntoViewIfNeeded();
    const mainBefore = await p.evaluate(() => document.querySelector('main').scrollTop);
    const was = await p.isChecked('input[data-setting="badge"]');
    await row.click();
    await p.waitForTimeout(300);
    const got = await p.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('main').scrollTop]);
    const now = await p.isChecked('input[data-setting="badge"]');
    await row.click(); // back as it was
    await p.close();
    check('toggling a setting keeps the popup in place', got[0] === 0 && got[1] === mainBefore && now === !was,
      `page=${got[0]}, main=${mainBefore}→${got[1]}, toggled=${now !== was}`);
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
  const notLoaded = await sw.evaluate(async () => {
    await inventoryChecked(0); // idle 1 → next in 30 min
    await inventoryChecked(0, false); // the page never rendered: says nothing about drops
    const { dropsCheck } = await chrome.storage.local.get('dropsCheck');
    await chrome.storage.local.remove('dropsCheck');
    return [dropsCheck.idle, Math.round((dropsCheck.nextAt - Date.now()) / 60e3)];
  });
  check('inventory that never rendered does not stretch the interval', JSON.stringify(notLoaded) === '[1,29]', notLoaded.join(','));

  // a pause without page input in a VISIBLE tab (media keys, PiP, browser media controls)
  // must stay a pause: only pauses right after the tab got hidden are undone
  {
    const p = await ctx.newPage();
    await p.goto('https://www.twitch.tv/playing');
    await p.waitForTimeout(2500); // Glint attaches to the video on its tick
    const playing = await p.evaluate(() => !document.getElementById('v').paused);
    await p.evaluate(() => document.getElementById('v').pause());
    await p.waitForTimeout(2000);
    const stillPaused = await p.evaluate(() => document.getElementById('v').paused);
    await p.close();
    check('a pause in a visible tab is left alone', playing && stillPaused, `playing=${playing}, stillPaused=${stillPaused}`);
  }

  // stream + popout chat of the same channel: both see the chest go and the balance grow
  {
    const before = await sw.evaluate(async () => (await chrome.storage.local.get('history')).history.filter(h => h.channel === 'dupe').length);
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await Promise.all([a.goto('https://www.twitch.tv/dupe'), b.goto('https://www.twitch.tv/popout/dupe/chat')]);
    await a.waitForTimeout(6000);
    const clicks = [await a.evaluate(() => window.__claimed), await b.evaluate(() => window.__claimed)];
    const after = await sw.evaluate(async () => (await chrome.storage.local.get('history')).history.filter(h => h.channel === 'dupe').length);
    await a.close(); await b.close();
    check('one chest claimed in two tabs of a channel is counted once', clicks[0] === 1 && clicks[1] === 1 && after - before === 1,
      `clicks=${clicks.join('+')}, recorded=${after - before}`);
  }

  // player recovery must not press the mature-content warning when skipping it is off
  {
    const setMature = on => sw.evaluate(async on => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, matureGate: on, autoRecover: true } });
    }, on);
    await setMature(false);
    const p = await ctx.newPage();
    await p.goto('https://www.twitch.tv/matureoverlay');
    await p.waitForTimeout(4000);
    const pressedWhenOff = await p.evaluate(() => window.__mature);
    await setMature(true);
    await p.waitForTimeout(3000);
    const pressedWhenOn = await p.evaluate(() => window.__mature);
    await p.close();
    check('mature warning: untouched when its switch is off, passed when on', pressedWhenOff === undefined && pressedWhenOn === 1,
      `off=${pressedWhenOff}, on=${pressedWhenOn}`);
    const sub = await ctx.newPage();
    await sub.goto('https://www.twitch.tv/subonly');
    await sub.waitForTimeout(4000);
    const subscribed = await sub.evaluate(() => window.__subscribe);
    await sub.close();
    check('player recovery ignores overlays without a retry button', subscribed === undefined, `pressed=${subscribed}`);
    // the real reload button: found by its text in Russian, by its refresh icon in any language
    const pressed = {};
    for (const lang of ['ru', 'ja']) {
      const pg = await ctx.newPage();
      await pg.goto(`https://www.twitch.tv/reload${lang}`);
      await pg.waitForTimeout(3000);
      pressed[lang] = await pg.evaluate(() => window.__reload);
      await pg.close();
    }
    check("Twitch's reload-player button is pressed in any language", pressed.ru === 1 && pressed.ja === 1, JSON.stringify(pressed));
  }

  // different drops claimed seconds apart may share a title: all of them count
  {
    const added = await sw.evaluate(async () => {
      const before = (await chrome.storage.local.get('stats')).stats.total.drops;
      const now = Date.now();
      recordClaim({ kind: 'drops', channel: '', title: 'Supply Box', at: now });
      await recordClaim({ kind: 'drops', channel: '', title: 'Supply Box', at: now + 2000 });
      return (await chrome.storage.local.get('stats')).stats.total.drops - before;
    });
    check('two drops with the same title in one pass both count', added === 2, `added=${added}`);
  }

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
    await recordClaim({ kind: 'points', channel: 'y', amount: 50, at: now }); // another channel: same-channel claims within a minute are duplicates
    const after = await chrome.storage.local.get(['stats', 'history']);
    await chrome.storage.local.set(saved);
    return [after.history.filter(h => h.kind === 'points').length, after.history.filter(h => h.kind === 'drops').length,
      Object.keys(after.stats.days).length];
  });
  check('history: 300 per kind, old drops survive; 366 days kept', JSON.stringify(kept) === '[300,5,366]', kept.join(','));

  // export → reset → import gives back the same statistics; bad files and junk fields are rejected
  {
    const before = await sw.evaluate(async () => chrome.storage.local.get(['stats', 'history']));
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.click('#tab-settings');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
    const file = path.join(out, 'export.json');
    await download.saveAs(file);
    // reset must also forget avatars, the drops pace and self-check notes (PRIVACY.md says so)
    const savedAvatars = await sw.evaluate(async () => {
      const { avatars } = await chrome.storage.local.get('avatars');
      await chrome.storage.local.set({ dropsCheck: { idle: 2, nextAt: Date.now() } });
      await chrome.storage.session.set({ health: { 'noBonus:points': { issue: 'noBonus', kind: 'points', channel: 'x', at: Date.now() } } });
      return avatars;
    });
    await p.click('#resetBtn'); await p.click('#resetBtn');
    await p.waitForTimeout(400);
    const afterReset = await sw.evaluate(async () => (await chrome.storage.local.get('stats')).stats.total.points);
    const leftovers = await sw.evaluate(async () => ({
      ...(await chrome.storage.local.get(['avatars', 'dropsCheck'])), ...(await chrome.storage.session.get('health'))
    }));
    check('reset statistics also forgets avatars, drops pace and self-check notes',
      Object.keys(leftovers).length === 0 && Object.keys(savedAvatars || {}).length > 0, Object.keys(leftovers).join(',') || 'nothing left');
    await sw.evaluate(a => chrome.storage.local.set({ avatars: a }), savedAvatars); // later checks use them

    const junk = path.join(out, 'not-glint.json');
    fs.writeFileSync(junk, JSON.stringify({ hello: 'world' }));
    await p.setInputFiles('#importFile', junk);
    await p.waitForTimeout(300);
    const rejected = await p.textContent('#importText');
    const noReplace = await p.isHidden('#importConfirm');

    await p.setInputFiles('#importFile', file);
    await p.waitForTimeout(300);
    const preview = await p.textContent('#importText');
    await p.locator('#importBox').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/import.png` });
    await p.click('#importConfirm');
    await p.waitForTimeout(500);
    const done = await p.textContent('#importText');
    const after = await sw.evaluate(async () => chrome.storage.local.get(['stats', 'history']));
    await p.close();
    // the test's demo data has missing fields, which import fills in: compare with the normalized export
    const expected = await sw.evaluate(b => GLINT.sanitizeImport(b), before);
    // chrome.storage returns keys sorted, so compare key-order-independently
    const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
    const sameTimes = JSON.stringify(after.history.map(h => h.at)) === JSON.stringify(before.history.map(h => h.at)) &&
      Object.entries(before.stats.channels).every(([n, c]) => after.stats.channels[n].last === c.last);
    const same = canon(after.stats) === canon(expected.stats) && canon(after.history) === canon(expected.history) &&
      after.stats.total.points === before.stats.total.points && sameTimes;
    check('export → reset → import restores the same statistics',
      afterReset === 0 && rejected.startsWith("This isn't a Glint") && noReplace &&
      preview.includes(`${before.stats.total.points.toLocaleString('en-US')} points`) && done === 'Statistics loaded.' && same,
      `reset=${afterReset}, rejected="${rejected.slice(0, 25)}", preview="${preview.slice(0, 60)}", done="${done}", same=${same}, times=${sameTimes}`);

    const cleaned = await sw.evaluate(() => GLINT.sanitizeImport({
      stats: { total: { points: '50', moments: -3, drops: 'x' }, days: { '2026-11-01': { points: 7 }, 'bad': { points: 9 } },
        channels: { shroud: { points: 5, last: 1 }, '../evil': { points: 1 }, xqc: 'nope' } },
      history: [{ kind: 'points', channel: '<img onerror=x>', amount: 50, at: 2, title: '<b>t</b>' }, { kind: 'hack', at: 3 },
        { kind: 'drops', at: 'later' }, { kind: 'moments', at: Date.now() + 30 * 864e5 }]
    }));
    check('import keeps only well-formed fields',
      JSON.stringify(cleaned.stats.total) === '{"points":50,"moments":0,"drops":0}' &&
      JSON.stringify(Object.keys(cleaned.stats.days)) === '["2026-11-01"]' &&
      JSON.stringify(Object.keys(cleaned.stats.channels)) === '["shroud"]' &&
      cleaned.history.length === 1 && cleaned.history[0].channel === '' && cleaned.history[0].title === '<b>t</b>',
      JSON.stringify(cleaned).slice(0, 160));
  }

  // drops check without a new tab: a channel tab loads the inventory in a hidden frame
  {
    await inv.close(); // the user's own inventory tab would be reloaded instead
    const pagesBefore = ctx.pages().length;
    const dropsBefore = await sw.evaluate(async () => ((await chrome.storage.local.get('stats')).stats.total.drops));
    await sw.evaluate(() => checkDrops(true));
    await new Promise(r => setTimeout(r, 2000));
    const host = (await Promise.all(ctx.pages().map(async p => ({ p, n: await p.locator('iframe[src*="glint=auto"]').count().catch(() => 0) }))))
      .find(x => x.n > 0);
    const hidden = host && await host.p.evaluate(() => {
      const f = document.querySelector('iframe[src*="glint=auto"]');
      const s = getComputedStyle(f);
      return s.opacity === '0' && s.pointerEvents === 'none';
    });
    await new Promise(r => setTimeout(r, 40000)); // the frame reports after 30 s plus click checks
    const after = await sw.evaluate(async () => {
      const { stats, dropsCheck } = await chrome.storage.local.get(['stats', 'dropsCheck']);
      return { drops: stats.total.drops, idle: dropsCheck && dropsCheck.idle };
    });
    const removed = host && await host.p.locator('iframe[src*="glint=auto"]').count() === 0;
    const toasted = host && await host.p.evaluate(() => !!document.querySelector('glint-toasts'));
    check('drops checked in a hidden frame: no new tab, drop claimed, toast in the tab, frame removed',
      !!host && hidden && ctx.pages().length === pagesBefore && after.drops === dropsBefore + 1 && after.idle === 0 && removed && toasted,
      `frame=${!!host}, hidden=${hidden}, pages=${ctx.pages().length - pagesBefore}, drops=${after.drops - dropsBefore}, idle=${after.idle}, removed=${removed}, toast=${toasted}`);
  }

  // toggling master off propagates to page
  await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, enabled: false } }); });
  await tw.waitForTimeout(500);
  check('keepAlive off remembered for page.js', await tw.evaluate(() => localStorage.getItem('glint-keepalive')) === '0');
  console.log('badge when paused:', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));
  console.log('page errors:', pageErr, 'SW errors:', swErr);
  check('no page or service worker errors', !pageErr.length && !swErr.length);

  // Tabs opened before an update don't answer the popup's ping. Playwright can't bring the
  // extension back after chrome.runtime.reload(), so the popup sees "no answer" from every tab
  // until it reloads them; that the scripts do answer is checked by "no stale-tabs notice".
  {
    const twitchTabs = ctx.pages().filter(pg => pg.url().startsWith('https://www.twitch.tv/')).length;
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 580 });
    await p.addInitScript(() => {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      const reload = chrome.tabs.reload.bind(chrome.tabs);
      window.__reloaded = 0;
      chrome.tabs.sendMessage = (id, msg, opts) => msg && msg.type === 'ping' && !window.__reloaded
        ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
        : send(id, msg, opts);
      chrome.tabs.reload = id => { window.__reloaded++; return reload(id); };
    });
    await p.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await p.waitForTimeout(1500);
    const shown = await p.isVisible('#staleNotice');
    const text = await p.textContent('#staleText');
    await p.screenshot({ path: `${out}/stale-tabs.png` });
    await p.click('#staleReload');
    await p.waitForTimeout(6000);
    const reloaded = await p.evaluate(() => window.__reloaded);
    const gone = await p.isHidden('#staleNotice');
    await p.close();
    check('stale tabs: counted, the button reloads them, the notice goes away',
      shown && text === `${twitchTabs} Twitch tabs were opened before Glint updated` && reloaded === twitchTabs && gone,
      `shown=${shown}, "${text}", tabs=${twitchTabs}, reloaded=${reloaded}, gone=${gone}`);
  }

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
