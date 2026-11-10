/* Glint service worker: records claims, schedules drop checks, badge and notifications. */
'use strict';
importScripts('/src/shared/defaults.js');

const {
  DEFAULT_SETTINGS, DAYS_MAX, DROPS_INTERVAL_MIN, DROPS_MAX_INTERVAL_MIN, INVENTORY_URL,
  channelFromPath, dayKey, emptyStats
} = GLINT;

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// ---- claim recording (writes are serialized so parallel claims don't clobber) ----
let writeChain = Promise.resolve();

const { trimHistory } = GLINT;

/** The popup (or another page of the extension itself), not a script on a Twitch page. */
function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''));
}

/** Replace all statistics (import from a file, or reset with empty data), in the write queue. */
function replaceStats(data) {
  writeChain = writeChain.then(async () => {
    const clean = GLINT.sanitizeImport(data);
    if (!clean) throw new Error('not a Glint export');
    await chrome.storage.local.set({ stats: clean.stats, history: clean.history });
    await updateBadge(clean.stats);
  });
  const done = writeChain;
  writeChain = writeChain.catch(e => console.error('Glint: failed to replace stats', e));
  return done;
}

function recordClaim(claim) {
  writeChain = writeChain.then(async () => {
    const { stats = emptyStats(), history = [] } = await chrome.storage.local.get(['stats', 'history']);
    const kind = claim.kind;
    const amount = kind === 'points' ? Math.max(0, Math.round(claim.amount || 0)) : 1;
    const day = dayKey(claim.at);
    const channel = claim.channel || '';

    stats.total[kind] = (stats.total[kind] || 0) + amount;
    const d = (stats.days[day] = stats.days[day] || { points: 0, moments: 0, drops: 0 });
    d[kind] = (d[kind] || 0) + amount;
    if (channel) {
      const c = (stats.channels[channel] = stats.channels[channel] || { points: 0, moments: 0, drops: 0, last: 0 });
      c[kind] = (c[kind] || 0) + amount;
      c.last = claim.at;
    }
    const days = Object.keys(stats.days).sort();
    days.slice(0, Math.max(0, days.length - DAYS_MAX)).forEach(k => delete stats.days[k]);

    history.unshift({
      kind,
      channel,
      amount,
      approx: !!claim.approx,
      title: claim.title || '',
      at: claim.at
    });

    await chrome.storage.local.set({ stats, history: trimHistory(history) });
    await clearIssues(kind);
    await updateBadge(stats);
    await notify(claim);
  }).catch(e => console.error('Glint: failed to record claim', e));
  return writeChain;
}

// ---- channel avatars: storage.local.avatars = { name: {url, at} } ----
const AVATARS_MAX = 500;
const AVATAR_REFRESH_MS = 864e5; // a day

function recordAvatar(channel, url) {
  writeChain = writeChain.then(async () => {
    const { avatars = {} } = await chrome.storage.local.get('avatars');
    const old = avatars[channel];
    // A known channel is updated at most once a day: that refreshes the timestamp and picks
    // up a new picture, without flipping between pictures if Twitch pages disagree.
    if (old && Date.now() - old.at < AVATAR_REFRESH_MS) return;
    avatars[channel] = { url, at: Date.now() };
    const names = Object.keys(avatars);
    if (names.length > AVATARS_MAX) {
      names.sort((a, b) => avatars[a].at - avatars[b].at)
        .slice(0, names.length - AVATARS_MAX).forEach(n => delete avatars[n]);
    }
    await chrome.storage.local.set({ avatars });
  }).catch(e => console.error('Glint: failed to record avatar', e));
}

// ---- self-check: problems reported by content scripts, shown in the popup ----
// storage.session.health = { 'issue:kind': {issue, kind, channel, at} }
const ISSUES = ['clickFailed', 'noWidget', 'noBonus'];

function recordIssue(msg) {
  writeChain = writeChain.then(async () => {
    const { health = {} } = await chrome.storage.session.get('health');
    health[`${msg.issue}:${msg.kind}`] = {
      issue: msg.issue, kind: msg.kind, channel: String(msg.channel || '').slice(0, 25), at: Date.now()
    };
    await chrome.storage.session.set({ health });
  }).catch(e => console.error('Glint: failed to record issue', e));
}

/** A successful claim proves that kind works again. */
async function clearIssues(kind) {
  const { health = {} } = await chrome.storage.session.get('health');
  const keys = Object.keys(health).filter(k => health[k].kind === kind);
  if (!keys.length) return;
  keys.forEach(k => delete health[k]);
  await chrome.storage.session.set({ health });
}

async function notify(claim) {
  const s = await getSettings();
  const want = (claim.kind === 'drops' && s.notifyDrops) || (claim.kind === 'moments' && s.notifyMoments);
  if (!want) return;
  const title = chrome.i18n.getMessage(claim.kind === 'drops' ? 'notifDropTitle' : 'notifMomentTitle');
  chrome.notifications.create(`glint|${claim.kind}|${claim.channel || ''}|${claim.at}`, {
    type: 'basic',
    iconUrl: '/icons/icon-128.png',
    title,
    message: claim.title || claim.channel || 'Twitch',
    contextMessage: claim.channel ? `twitch.tv/${claim.channel}` : '',
    silent: true
  });
}

// ---- badge: points collected today ----
// At most 3 characters so the badge covers as little of the icon as possible:
// 50, 850, 1k, 12k. A day's bonuses realistically never reach 100k, so it stops at 99k.
function shortNumber(n) {
  n = Math.max(0, Math.floor(n || 0));
  return n < 1000 ? String(n) : `${Math.min(Math.floor(n / 1000), 99)}k`;
}

async function updateBadge(stats) {
  const s = await getSettings();
  if (!stats) stats = (await chrome.storage.local.get('stats')).stats || emptyStats();
  const today = stats.days[dayKey()];
  const pts = today ? today.points : 0;
  const text = s.enabled && s.badge && pts ? shortNumber(pts) : '';
  await chrome.action.setBadgeBackgroundColor({ color: '#C8922E' });
  chrome.action.setBadgeTextColor && (await chrome.action.setBadgeTextColor({ color: '#10201F' }));
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({
    title: s.enabled ? 'Glint' : `Glint: ${chrome.i18n.getMessage('statusPaused')}`
  });
}

// ---- drops: periodically open the inventory page in a background tab ----
// The alarm fires every DROPS_INTERVAL_MIN; storage.local.dropsCheck = {idle, nextAt}
// stretches the real interval (15 → 30 → 60 min) while the inventory has nothing to claim.
async function checkDrops(force = false) {
  const s = await getSettings();
  if (!s.enabled || !s.drops) return;
  const { dropsCheck = {} } = await chrome.storage.local.get('dropsCheck');
  if (!force && Date.now() < (dropsCheck.nextAt || 0)) return;
  const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
  const inventory = tabs.find(t => t.url && t.url.startsWith(INVENTORY_URL));
  const channels = tabs.filter(t => channelFromPath(t.url));
  if (!channels.length) return; // no channel open, nothing earns drops
  if (inventory) {
    if (!inventory.active) chrome.tabs.reload(inventory.id);
    return;
  }
  // No new tab: ask an open channel tab to load the inventory in a hidden same-origin
  // frame (twitch.tv allows that: X-Frame-Options SAMEORIGIN). Background tabs first,
  // so the stream being watched isn't slowed down by loading another Twitch page.
  channels.sort((a, b) => Number(a.active) - Number(b.active));
  for (const tab of channels) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'checkInventory' }, { frameId: 0 });
      if (res && res.ok) return;
    } catch (e) {
      // no Glint script in that tab (opened before an update): try the next one
    }
  }
}

async function inventoryChecked(claimed) {
  const { dropsCheck = {} } = await chrome.storage.local.get('dropsCheck');
  const idle = claimed > 0 ? 0 : (dropsCheck.idle || 0) + 1;
  const minutes = Math.min(DROPS_INTERVAL_MIN * 2 ** idle, DROPS_MAX_INTERVAL_MIN);
  // a minute of slack so the next alarm tick is not missed by a few seconds
  await chrome.storage.local.set({ dropsCheck: { idle, nextAt: Date.now() + (minutes - 1) * 60e3 } });
}

function scheduleDrops() {
  chrome.alarms.create('drops', { delayInMinutes: 2, periodInMinutes: DROPS_INTERVAL_MIN });
  // new browser session: campaigns may have started, check at the normal pace again
  chrome.storage.local.remove('dropsCheck');
}

function scheduleMidnight() {
  const next = new Date();
  next.setHours(24, 0, 5, 0);
  chrome.alarms.create('midnight', { when: next.getTime() });
}

// ---- listeners (registered synchronously so they survive worker restarts) ----
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  scheduleDrops();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleDrops();
  updateBadge();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'drops') checkDrops();
  if (alarm.name === 'midnight') {
    updateBadge();
    scheduleMidnight();
  }
});
scheduleMidnight();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'claim' && ['points', 'moments', 'drops'].includes(msg.kind)) {
    recordClaim({ ...msg, at: Number(msg.at) || Date.now() }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'avatar') {
    const channel = channelFromPath(`/${msg.channel || ''}`);
    const url = GLINT.avatarUrl(msg.url);
    channel && url && recordAvatar(channel, url);
    return;
  }
  if (msg.type === 'health' && ISSUES.includes(msg.issue) && ['points', 'moments', 'drops'].includes(msg.kind)) {
    recordIssue(msg);
    return;
  }
  // the hidden inventory frame finished: remember the result, let the tab remove the frame
  if (msg.type === 'inventoryDone' && sender.tab && sender.frameId > 0) {
    inventoryChecked(Number(msg.claimed) || 0);
    chrome.tabs.sendMessage(sender.tab.id, { type: 'inventoryClose' }, { frameId: 0 }).catch(() => {});
    return;
  }
  if (msg.type === 'checkDropsNow') {
    checkDrops(true).then(() => sendResponse({ ok: true }));
    return true;
  }
  // import / reset from the popup only (never from a script running on a Twitch page)
  if (msg.type === 'replaceStats' && fromExtensionPage(sender)) {
    replaceStats(msg.data).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) updateBadge();
  if (area === 'local' && changes.stats && !changes.stats.newValue) updateBadge();
});

chrome.notifications.onClicked.addListener(id => {
  const [prefix, kind, channel] = id.split('|');
  if (prefix === 'glint') {
    chrome.tabs.create({ url: kind === 'moments' && channel ? `https://www.twitch.tv/${channel}` : INVENTORY_URL });
  }
  chrome.notifications.clear(id);
});
