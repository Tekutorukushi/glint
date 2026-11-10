/* Glint service worker: records claims, schedules drop checks, badge and notifications. */
'use strict';
importScripts('/src/shared/defaults.js');

const {
  DEFAULT_SETTINGS, HISTORY_MAX, DROPS_INTERVAL_MIN, DROPS_MAX_INTERVAL_MIN, INVENTORY_URL,
  channelFromPath, dayKey, emptyStats
} = GLINT;
const AUTO_PARAM = 'glint=auto';

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// ---- claim recording (writes are serialized so parallel claims don't clobber) ----
let writeChain = Promise.resolve();

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
    // keep ~60 days of daily totals
    const days = Object.keys(stats.days).sort();
    days.slice(0, Math.max(0, days.length - 60)).forEach(k => delete stats.days[k]);

    history.unshift({
      kind,
      channel,
      amount,
      approx: !!claim.approx,
      title: claim.title || '',
      at: claim.at
    });
    history.length > HISTORY_MAX && (history.length = HISTORY_MAX);

    await chrome.storage.local.set({ stats, history });
    await updateBadge(stats);
    await notify(claim);
  }).catch(e => console.error('Glint: failed to record claim', e));
  return writeChain;
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
function shortNumber(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
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
  if (!tabs.some(t => channelFromPath(t.url))) return; // no channel open, nothing earns drops
  if (inventory) {
    if (!inventory.active) chrome.tabs.reload(inventory.id);
    return;
  }
  const tab = await chrome.tabs.create({ url: `${INVENTORY_URL}?${AUTO_PARAM}`, active: false, index: 0 });
  const { autoTabs = [] } = await chrome.storage.session.get('autoTabs');
  await chrome.storage.session.set({ autoTabs: [...autoTabs, tab.id] });
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
  if (msg.type === 'inventoryDone' && sender.tab) {
    chrome.storage.session.get('autoTabs').then(({ autoTabs = [] }) => {
      if (!autoTabs.includes(sender.tab.id)) return;
      chrome.storage.session.set({ autoTabs: autoTabs.filter(id => id !== sender.tab.id) });
      chrome.tabs.remove(sender.tab.id).catch(() => {});
      inventoryChecked(Number(msg.claimed) || 0);
    });
    return;
  }
  if (msg.type === 'checkDropsNow') {
    checkDrops(true).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) updateBadge();
  if (area === 'local' && changes.stats && !changes.stats.newValue) updateBadge();
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.get('autoTabs').then(({ autoTabs = [] }) => {
    autoTabs.includes(tabId) && chrome.storage.session.set({ autoTabs: autoTabs.filter(id => id !== tabId) });
  });
});

chrome.notifications.onClicked.addListener(id => {
  const [prefix, kind, channel] = id.split('|');
  if (prefix === 'glint') {
    chrome.tabs.create({ url: kind === 'moments' && channel ? `https://www.twitch.tv/${channel}` : INVENTORY_URL });
  }
  chrome.notifications.clear(id);
});
