/* © 2026 DENVER. All rights reserved. See LICENSE. */
/* Shared constants. Loaded as a classic script in every context. */
(() => {
  // first path segments on twitch.tv that are not channels
  const RESERVED = new Set([
    'directory', 'drops', 'settings', 'subscriptions', 'inventory', 'wallet', 'search',
    'videos', 'moderator', 'u', 'p', 'downloads', 'jobs', 'turbo', 'friends', 'messages',
    'following', 'prime', 'store', 'bits', 'login', 'signup', 'payments', 'popout'
  ]);

  globalThis.GLINT = Object.freeze({
    DEFAULT_SETTINGS: Object.freeze({
      enabled: true,
      points: true,
      moments: true,
      drops: true,
      keepAlive: true,
      autoRecover: true,
      matureGate: true,
      toasts: true,
      // where toasts appear on the Twitch page, one of TOAST_POSITIONS
      toastPosition: 'bottom-left',
      notifyDrops: true,
      notifyMoments: false,
      badge: true,
      avatars: true,
      // where points and moments are collected: 'all' | 'only' (channelList) | 'except' (channelList)
      channelMode: 'all',
      channelList: Object.freeze([])
    }),
    CHANNEL_LIST_MAX: 200,
    // reading order of the position picker: a 3×3 grid without its centre
    TOAST_POSITIONS: Object.freeze(['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right']),
    // history keeps the newest HISTORY_MAX events of EACH kind, so frequent points
    // don't push rare drops and moments out
    HISTORY_MAX: 300,
    // daily totals kept for the chart and export
    DAYS_MAX: 366,
    // drops check interval: starts at MIN, doubles while the inventory has nothing to claim
    DROPS_INTERVAL_MIN: 15,
    DROPS_MAX_INTERVAL_MIN: 60,
    INVENTORY_URL: 'https://www.twitch.tv/drops/inventory',

    /** Channel name from a twitch.tv path or URL, '' for service pages (directory, drops, ...). */
    channelFromPath(pathOrUrl) {
      let url;
      try { url = new URL(String(pathOrUrl || ''), 'https://www.twitch.tv'); } catch (e) { return ''; }
      if (!/(^|\.)twitch\.tv$/.test(url.hostname)) return '';
      const path = url.pathname;
      const parts = path.split('/').filter(Boolean).map(p => p.toLowerCase());
      const name = (parts[0] === 'popout' || parts[0] === 'moderator') ? parts[1] || '' : parts[0] || '';
      return RESERVED.has(name) || !/^[a-z0-9_]{2,25}$/.test(name) ? '' : name;
    },

    /** Channel name from what a person types: "xqc", "@xqc", "twitch.tv/xqc", a full URL. */
    channelFromInput(text) {
      const s = String(text || '').trim().toLowerCase().replace(/^@/, '')
        .replace(/^(https?:\/\/)?((www|m)\.)?twitch\.tv(?=\/|$)/, '');
      return globalThis.GLINT.channelFromPath(s.startsWith('/') ? s : `/${s}`);
    },

    /**
     * A channel avatar URL from Twitch's image server, resized to 70×70, or '' for
     * anything else. The only remote resource Glint ever loads (see PRIVACY.md).
     */
    avatarUrl(src) {
      let url;
      try { url = new URL(String(src || '')); } catch (e) { return ''; }
      if (url.protocol !== 'https:' || url.hostname !== 'static-cdn.jtvnw.net') return '';
      if (!url.pathname.startsWith('/jtv_user_pictures/')) return '';
      return `https://static-cdn.jtvnw.net${url.pathname.replace(/-profile_image-\d+x\d+\./, '-profile_image-70x70.')}`;
    },

    /** Keep the newest HISTORY_MAX events of each kind (history is newest first). */
    trimHistory(history) {
      const seen = {};
      const max = globalThis.GLINT.HISTORY_MAX;
      return history.filter(h => (seen[h.kind] = (seen[h.kind] || 0) + 1) <= max);
    },

    /**
     * Statistics from an exported file, checked field by field: only numbers, dates and
     * channel names of the right shape get through. Returns { stats, history, exportedAt }
     * or null if this is not a Glint export.
     */
    sanitizeImport(raw) {
      const G = globalThis.GLINT;
      const KINDS = ['points', 'moments', 'drops'];
      const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
      if (!isObj(raw) || !isObj(raw.stats) || !isObj(raw.stats.total) || !isObj(raw.stats.days)) return null;
      const num = v => (Number.isFinite(+v) && +v > 0 ? Math.min(Math.floor(+v), 1e15) : 0);
      // timestamps in ms; nothing from the future (a day of slack for clocks and time zones)
      const ts = v => { const n = num(v); return n <= Date.now() + 864e5 ? n : 0; };
      const counts = o => ({ points: num(o && o.points), moments: num(o && o.moments), drops: num(o && o.drops) });
      const channelOk = name => typeof name === 'string' && G.channelFromPath(`/${name}`) === name;

      const stats = G.emptyStats();
      stats.total = counts(raw.stats.total);
      Object.keys(raw.stats.days).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-G.DAYS_MAX)
        .forEach(k => { stats.days[k] = counts(raw.stats.days[k]); });
      Object.entries(isObj(raw.stats.channels) ? raw.stats.channels : {})
        .filter(([name, c]) => channelOk(name) && isObj(c)).slice(0, 5000)
        .forEach(([name, c]) => { stats.channels[name] = { ...counts(c), last: ts(c.last) }; });

      const history = (Array.isArray(raw.history) ? raw.history : [])
        .filter(h => isObj(h) && KINDS.includes(h.kind) && ts(h.at))
        .map(h => ({
          kind: h.kind,
          channel: channelOk(h.channel) ? h.channel : '',
          amount: h.kind === 'points' ? num(h.amount) : 1,
          approx: !!h.approx,
          title: String(h.title || '').slice(0, 200),
          at: ts(h.at)
        }))
        .sort((a, b) => b.at - a.at);
      return { stats, history: G.trimHistory(history), exportedAt: Date.parse(raw.exportedAt) || 0 };
    },

    /** Whether points and moments should be collected on this channel. */
    collectsOn(channel, settings) {
      const list = Array.isArray(settings.channelList) ? settings.channelList : [];
      if (settings.channelMode === 'only') return !!channel && list.includes(channel);
      if (settings.channelMode === 'except') return !channel || !list.includes(channel);
      return true;
    },

    /** Local calendar day as YYYY-MM-DD. */
    dayKey(ts = Date.now()) {
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    emptyStats() {
      return { total: { points: 0, moments: 0, drops: 0 }, days: {}, channels: {} };
    }
  });
})();
