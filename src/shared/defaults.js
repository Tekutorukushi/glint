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
      notifyDrops: true,
      notifyMoments: false,
      badge: true,
      avatars: true,
      // where points and moments are collected: 'all' | 'only' (channelList) | 'except' (channelList)
      channelMode: 'all',
      channelList: Object.freeze([])
    }),
    CHANNEL_LIST_MAX: 200,
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
