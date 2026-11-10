/* Glint content script for www.twitch.tv (isolated world). */
(() => {
  'use strict';
  if (window.__glintLoaded) return;
  window.__glintLoaded = true;

  const { DEFAULT_SETTINGS } = GLINT;
  const TICK_MS = 1500;

  let settings = { ...DEFAULT_SETTINGS };
  let timer = null;
  let lastUserInput = 0;
  const cooldowns = new Map();
  const isInventory = () => location.pathname.startsWith('/drops/inventory');
  const isAutoInventory = isInventory() && new URLSearchParams(location.search).get('glint') === 'auto';

  // ------------------------------------------------------------------ helpers
  // After the extension is updated or reloaded, this script keeps running in tabs that were
  // already open, but chrome.* is gone. Such an orphan must stop quietly; a tab reload
  // brings in the new version.
  function alive() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }
  const t = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch (e) { return key; }
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function onCooldown(key, ms) {
    const now = Date.now();
    if ((cooldowns.get(key) || 0) > now) return true;
    cooldowns.set(key, now + ms);
    return false;
  }

  /** Exponential pause after clicks that did nothing: 1, 2, 4 ... up to 10 minutes. */
  const failures = new Map();
  function backoff(key) {
    const n = (failures.get(key) || 0) + 1;
    failures.set(key, n);
    const ms = Math.min(60e3 * 2 ** (n - 1), 10 * 60e3);
    cooldowns.set(key, Date.now() + ms);
    console.warn(`Glint: ${key} click had no effect (${n}x), next try in ${ms / 1000}s`);
    reportIssue('clickFailed', key);
  }

  /** Tell the popup that something looks broken (at most once per 10 min per issue). */
  function reportIssue(issue, kind) {
    if (onCooldown(`issue:${issue}:${kind}`, 10 * 60e3)) return;
    send({ type: 'health', issue, kind, channel: currentChannel() });
  }

  /** After a click, resolves true if the button is gone, disabled or no longer a claim button. */
  function clickWorked(btn, stillClaimable, ms) {
    return new Promise(resolve => setTimeout(() => {
      resolve(!btn.isConnected || btn.disabled || !stillClaimable());
    }, ms));
  }

  const currentChannel = () => GLINT.channelFromPath(location.pathname);

  function send(msg) {
    if (!alive()) return stop();
    try {
      return chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (e) {
      stop();
    }
  }

  function textOf(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parseExact(text) {
    const s = String(text || '').replace(/[\s  ]/g, '');
    if (/[kmкм]/i.test(s)) return null;
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  // ------------------------------------------------------------------ toasts
  let toastHost = null;
  function toast(kind, title, sub) {
    if (!settings.toasts || window.top !== window) return;
    if (!toastHost) {
      toastHost = document.createElement('glint-toasts');
      toastHost.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;pointer-events:none';
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        :host { all: initial; }
        .stack { display: flex; flex-direction: column-reverse; gap: 8px; }
        .toast {
          display: grid; grid-template-columns: 28px auto; align-items: center; gap: 10px;
          min-width: 180px; max-width: 300px; padding: 10px 14px 10px 10px;
          background: #13302C; color: #ECE7D9; border-radius: 14px;
          box-shadow: 0 0 0 1px rgba(217,164,65,.35), 0 12px 32px rgba(4,14,13,.45);
          font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
          transform: translateY(12px); opacity: 0;
          transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s;
        }
        .toast.in { transform: none; opacity: 1; }
        .coin { width: 28px; height: 28px; }
        .title { font-weight: 650; font-variant-numeric: tabular-nums; }
        .sub { color: #9DB3AD; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) { .toast { transition: opacity .2s; transform: none; } }
      </style><div class="stack"></div>`;
      document.documentElement.appendChild(toastHost);
    }
    const stack = toastHost.shadowRoot.querySelector('.stack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${coinSvg(kind)}<div><div class="title"></div><div class="sub"></div></div>`;
    el.querySelector('.title').textContent = title;
    el.querySelector('.sub').textContent = sub || '';
    stack.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 400);
    }, 4200);
  }

  function coinSvg(kind) {
    const glyph = {
      points: '<path d="M14 7.5l1.6 4.1 4.4.3-3.4 2.8 1.1 4.3-3.7-2.4-3.7 2.4 1.1-4.3-3.4-2.8 4.4-.3z" fill="#13302C"/>',
      moments: '<rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="#13302C" stroke-width="2"/><circle cx="14" cy="14" r="2" fill="#13302C"/>',
      drops: '<path d="M14 7.5c2.6 3.3 4.2 5.6 4.2 7.5a4.2 4.2 0 0 1-8.4 0c0-1.9 1.6-4.2 4.2-7.5z" fill="#13302C"/>'
    }[kind];
    return `<svg class="coin" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#D9A441"/><circle cx="14" cy="14" r="10.5" fill="none" stroke="#F3D58B" stroke-width="1"/>${glyph}</svg>`;
  }

  // ------------------------------------------------------------------ points
  function findBonusButton() {
    const icon = $('.community-points-summary .claimable-bonus__icon, [data-test-selector="community-points-summary"] .claimable-bonus__icon');
    if (icon) return icon.closest('button');
    return $$('.community-points-summary button, [data-test-selector="community-points-summary"] button')
      .find(b => /bonus|бонус|bonificaci|bônus|prämie/i.test(b.getAttribute('aria-label') || ''));
  }

  function readBalance() {
    const el = $('[data-test-selector="balance-string"]') || $('.community-points-summary [class*="balance"]');
    return el ? parseExact(textOf(el)) : null;
  }

  function claimPoints() {
    const btn = findBonusButton();
    if (!btn || onCooldown('points', 8000)) return;
    const channel = currentChannel();
    const before = readBalance();
    const summary = btn.closest('.community-points-summary') || btn.parentElement;
    btn.click();

    // The amount shows up as a short "+50" animation; fall back to the balance delta.
    // Nothing is recorded unless the page confirms the claim.
    let settled = false;
    const finish = (amount, approx) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      failures.delete('points');
      send({ type: 'claim', kind: 'points', channel, amount, approx, at: Date.now() });
      toast('points', `+${amount.toLocaleString()} ${t('toastPoints')}`, channel ? `twitch.tv/${channel}` : '');
    };
    const scan = () => {
      const plus = $$('*', summary).map(textOf).find(s => /^\+\s?\d[\d\s,.]*$/.test(s));
      const n = plus && parseExact(plus);
      n && finish(n, false);
    };
    const observer = new MutationObserver(scan);
    summary && observer.observe(summary, { childList: true, subtree: true, characterData: true });
    clickWorked(btn, () => !!findBonusButton(), 4000).then(worked => {
      if (settled) return;
      const after = readBalance();
      const delta = before != null && after != null ? after - before : 0;
      if (delta > 0 && delta < 100000) return finish(delta, false);
      if (worked) return finish(50, true);
      settled = true;
      observer.disconnect();
      backoff('points');
    });
  }

  // ------------------------------------------------------------------ moments
  const MOMENT_CLAIM = /claim|получить|забрать|reclamar|resgatar|abholen/i;
  const isMomentClaim = b => MOMENT_CLAIM.test(textOf(b) + ' ' + (b.getAttribute('aria-label') || ''));
  function findMomentButton() {
    return $$('[class*="community-moment"] button, [class*="moment-callout"] button, [data-test-selector*="moment" i] button')
      .find(b => !b.disabled && isMomentClaim(b));
  }

  function claimMoments() {
    const btn = findMomentButton();
    if (!btn || onCooldown('moments', 15000)) return;
    const channel = currentChannel();
    const box = btn.closest('[class*="moment"]');
    const title = box ? textOf(box.querySelector('p, h3, h4, [class*="title"]')) : '';
    btn.click();
    clickWorked(btn, () => isMomentClaim(btn), 3000).then(worked => {
      if (!worked) return backoff('moments');
      failures.delete('moments');
      send({ type: 'claim', kind: 'moments', channel, title, at: Date.now() });
      toast('moments', t('toastMoment'), title || (channel ? `twitch.tv/${channel}` : ''));
    });
  }

  // ------------------------------------------------------------------ drops (inventory page)
  const claimedDrops = new WeakSet();
  let dropsClaimed = 0;
  const isDropClaim = b =>
    /^(claim now|claim|получить сейчас|получить|забрать|reclamar ahora|resgatar agora|jetzt abholen)$/i.test(textOf(b));
  function claimDrops() {
    const main = $('main') || document.body;
    const buttons = $$('button', main).filter(b => !claimedDrops.has(b) && !b.disabled && isDropClaim(b));
    buttons.forEach(b => {
      claimedDrops.add(b);
      let box = b.parentElement;
      for (let i = 0; i < 6 && box && !box.querySelector('img'); i++) box = box.parentElement;
      const title = box ? textOf(box.querySelector('p')) : '';
      b.click();
      clickWorked(b, () => isDropClaim(b), 3000).then(worked => {
        // a button that ignored the click gets another chance on a later tick
        if (!worked) {
          claimedDrops.delete(b);
          return reportIssue('clickFailed', 'drops');
        }
        dropsClaimed++;
        send({ type: 'claim', kind: 'drops', channel: '', title, at: Date.now() });
        toast('drops', t('toastDrop'), title);
      });
    });
  }

  // ------------------------------------------------------------------ player
  // Click "try again" a few times; if the error keeps coming back, reload the page,
  // but no more than once per RELOAD_GAP so a long outage can't cause a reload loop.
  const RECOVER_KEY = 'glint-recover';
  const RELOAD_GAP = 10 * 60e3;
  function recoverPlayer() {
    const gate = $('[data-a-target="player-overlay-content-gate"] button, .content-overlay-gate button');
    if (!gate || onCooldown('recover', 20000)) return;
    const now = Date.now();
    let state;
    try { state = JSON.parse(sessionStorage.getItem(RECOVER_KEY)) || {}; } catch (e) { state = {}; }
    const clicks = (Array.isArray(state.clicks) ? state.clicks : []).filter(ts => now - ts < 5 * 60e3);
    const reloadedAt = Number(state.reloadedAt) || 0;
    const reload = clicks.length >= 3 && now - reloadedAt > RELOAD_GAP;
    const next = reload ? { clicks: [], reloadedAt: now } : { clicks: [...clicks, now], reloadedAt };
    try { sessionStorage.setItem(RECOVER_KEY, JSON.stringify(next)); } catch (e) { return; }
    reload ? location.reload() : gate.click();
  }

  function passMatureGate() {
    const btn = $('[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"]');
    btn && !onCooldown('mature', 5000) && btn.click();
  }

  // resume playback that wasn't paused by the user
  const watched = new WeakSet();
  function guardVideo() {
    $$('video').forEach(v => {
      if (watched.has(v)) return;
      watched.add(v);
      v.addEventListener('pause', () => {
        if (!alive() || !settings.enabled || !settings.keepAlive) return;
        if (Date.now() - lastUserInput < 2000) return;
        setTimeout(() => { v.paused && !v.ended && v.play().catch(() => {}); }, 600);
      });
    });
  }
  ['pointerdown', 'keydown'].forEach(type =>
    document.addEventListener(type, e => { e.isTrusted && (lastUserInput = Date.now()); }, true));

  // ------------------------------------------------------------------ self-check
  // If Twitch changes its markup, Glint silently stops finding things. Watch for that:
  // the points block missing while a stream plays, or no bonus chest for a long time.
  const NO_WIDGET_MS = 3 * 60e3;
  const NO_BONUS_MS = 40 * 60e3; // the chest normally shows up every ~15 minutes
  const health = { channel: '', lastTickAt: 0, noWidgetMs: 0, sinceBonusMs: 0 };
  function selfCheck() {
    const now = Date.now();
    const step = Math.min(now - (health.lastTickAt || now), 60e3); // background tabs tick slowly
    health.lastTickAt = now;
    const channel = currentChannel();
    if (channel !== health.channel) Object.assign(health, { channel, noWidgetMs: 0, sinceBonusMs: 0 });
    if (!channel || window.top !== window) return;
    const playing = $$('video').some(v => !v.paused && v.readyState > 2);
    const loggedOut = !!$('[data-a-target="login-button"]');
    if (!playing || loggedOut) return;

    const summary = $('.community-points-summary, [data-test-selector="community-points-summary"]');
    if (!summary) {
      health.noWidgetMs += step;
      health.noWidgetMs > NO_WIDGET_MS && reportIssue('noWidget', 'points');
      return;
    }
    health.noWidgetMs = 0;
    if (findBonusButton()) health.sinceBonusMs = 0;
    else health.sinceBonusMs += step;
    health.sinceBonusMs > NO_BONUS_MS && reportIssue('noBonus', 'points');
  }

  // ------------------------------------------------------------------ loop
  function tick() {
    if (!alive()) return stop();
    if (!settings.enabled) return;
    try {
      if (isInventory()) {
        settings.drops && claimDrops();
        return;
      }
      const here = GLINT.collectsOn(currentChannel(), settings);
      if (settings.points && here) {
        selfCheck();
        claimPoints();
      }
      settings.moments && here && claimMoments();
      settings.autoRecover && recoverPlayer();
      settings.matureGate && passMatureGate();
      guardVideo();
    } catch (e) {
      console.warn('Glint:', e);
    }
  }

  function pushPageConfig() {
    const keepAlive = settings.enabled && settings.keepAlive;
    window.postMessage({ glint: 'config', keepAlive }, location.origin);
    // page.js reads this on the next load, before our settings arrive
    try { localStorage.setItem('glint-keepalive', keepAlive ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function start() {
    timer = timer || setInterval(tick, TICK_MS);
    tick();
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  chrome.storage.sync.get('settings').then(({ settings: s }) => {
    settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
    pushPageConfig();
    start();
    if (isAutoInventory) {
      // background tab opened by Glint: give the page time to load and claim, then close it
      setTimeout(() => send({ type: 'inventoryDone', claimed: dropsClaimed }), 25000);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    pushPageConfig();
  });
})();
