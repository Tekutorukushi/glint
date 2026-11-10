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
      badge: true
    }),
    HISTORY_MAX: 300,
    // drops check interval: starts at MIN, doubles while the inventory has nothing to claim
    DROPS_INTERVAL_MIN: 15,
    DROPS_MAX_INTERVAL_MIN: 60,
    INVENTORY_URL: 'https://www.twitch.tv/drops/inventory',

    /** Channel name from a twitch.tv path or URL, '' for service pages (directory, drops, ...). */
    channelFromPath(pathOrUrl) {
      let path;
      try { path = new URL(String(pathOrUrl || ''), 'https://www.twitch.tv').pathname; } catch (e) { return ''; }
      const parts = path.split('/').filter(Boolean).map(p => p.toLowerCase());
      const name = (parts[0] === 'popout' || parts[0] === 'moderator') ? parts[1] || '' : parts[0] || '';
      return RESERVED.has(name) || !/^[a-z0-9_]{2,25}$/.test(name) ? '' : name;
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
