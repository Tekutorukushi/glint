/* Shared constants. Loaded as a classic script in every context. */
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
  DROPS_INTERVAL_MIN: 15,
  INVENTORY_URL: 'https://www.twitch.tv/drops/inventory',

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
