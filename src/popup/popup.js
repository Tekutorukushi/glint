/* Glint popup logic. */
(() => {
  'use strict';
  const { DEFAULT_SETTINGS, dayKey, emptyStats } = GLINT;
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  const $ = id => document.getElementById(id);
  const locale = chrome.i18n.getUILanguage();
  const fmt = n => Number(n || 0).toLocaleString(locale);

  let settings = { ...DEFAULT_SETTINGS };
  let stats = emptyStats();
  let history = [];
  let avatars = {};
  let historyKind = 'all';
  let historyChannel = '';
  let lastToday = null;

  // ------------------------------------------------------------ i18n
  document.documentElement.lang = locale.split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    if (el.tagName === 'BUTTON') el.title = t(el.dataset.i18nLabel); // icon buttons get a tooltip
  });
  $('version').textContent = t('versionLine', [chrome.runtime.getManifest().version]);

  // ------------------------------------------------------------ tabs
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab) {
    tabs.forEach(b => {
      const on = b === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute('aria-controls')).hidden = !on;
    });
    // the channel list is only built while visible; after this script has fully run
    if (tab.id === 'tab-channels') queueMicrotask(() => renderAllChannels());
    try { localStorage.setItem('glint-tab', tab.id); } catch (e) { /* ignore */ }
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => selectTab(b));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      selectTab(next);
      next.focus();
    });
  });
  try {
    const saved = localStorage.getItem('glint-tab');
    saved && $(saved) && selectTab($(saved));
  } catch (e) { /* ignore */ }

  // ------------------------------------------------------------ settings
  const master = $('masterSwitch');
  const toggles = Array.from(document.querySelectorAll('[data-setting]'));

  function renderSettings() {
    master.checked = settings.enabled;
    $('masterLabel').textContent = t(settings.enabled ? 'statusOn' : 'statusPaused');
    document.body.classList.toggle('off', !settings.enabled);
    toggles.forEach(input => { input.checked = !!settings[input.dataset.setting]; });
    renderChannelList();
  }

  function saveSetting(key, value) {
    settings = { ...settings, [key]: value };
    chrome.storage.sync.set({ settings });
    renderSettings();
    renderStatus();
  }

  // ------------------------------------------------------------ channel list
  const modeButtons = Array.from(document.querySelectorAll('#channelMode button'));
  const channelInput = $('addChannelInput');
  let currentTabChannel = '';

  function renderChannelList() {
    const mode = settings.channelMode;
    const list = settings.channelList || [];
    modeButtons.forEach(b => {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const hint = $('channelModeHint');
    const empty = mode === 'only' && !list.length;
    hint.textContent = t(empty ? 'modeOnlyEmpty' : { all: 'modeAllHint', only: 'modeOnlyHint', except: 'modeExceptHint' }[mode]);
    hint.classList.toggle('warn', empty);

    const chips = $('channelChips');
    chips.replaceChildren(...list.map(name => {
      const li = document.createElement('li');
      li.textContent = name;
      const x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', t('removeChannel', [name]));
      x.title = t('removeChannel', [name]);
      x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8"/></svg>';
      x.addEventListener('click', () => saveSetting('channelList', list.filter(n => n !== name)));
      li.append(x);
      return li;
    }));

    const suggest = $('addCurrent');
    suggest.hidden = !currentTabChannel || list.includes(currentTabChannel);
    suggest.textContent = t('addCurrentChannel', [currentTabChannel]);
  }

  function addChannel(name) {
    const list = settings.channelList || [];
    if (!name) return false;
    if (!list.includes(name) && list.length < GLINT.CHANNEL_LIST_MAX) saveSetting('channelList', [...list, name]);
    return true;
  }

  modeButtons.forEach((b, i) => {
    b.addEventListener('click', () => saveSetting('channelMode', b.dataset.mode));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = modeButtons[(i + d + modeButtons.length) % modeButtons.length];
      saveSetting('channelMode', next.dataset.mode);
      next.focus();
    });
  });
  $('addChannelForm').addEventListener('submit', e => {
    e.preventDefault();
    const ok = addChannel(GLINT.channelFromInput(channelInput.value));
    channelInput.setAttribute('aria-invalid', String(!ok && !!channelInput.value.trim()));
    if (ok) channelInput.value = '';
  });
  channelInput.addEventListener('input', () => channelInput.removeAttribute('aria-invalid'));
  $('addCurrent').addEventListener('click', () => addChannel(currentTabChannel));
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    currentTabChannel = tab ? GLINT.channelFromPath(tab.url || '') : '';
    renderChannelList();
  });

  master.addEventListener('change', () => saveSetting('enabled', master.checked));
  toggles.forEach(input => input.addEventListener('change', () => saveSetting(input.dataset.setting, input.checked)));

  // ------------------------------------------------------------ status line
  async function renderStatus() {
    const el = $('status');
    if (!settings.enabled) {
      el.className = 'status';
      el.textContent = t('statusLinePaused');
      return;
    }
    const tabsOpen = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
    const open = [...new Set(tabsOpen.map(tab => GLINT.channelFromPath(tab.url)).filter(Boolean))];
    const channels = open.filter(c => GLINT.collectsOn(c, settings));
    if (!channels.length) {
      el.className = 'status';
      el.textContent = t(open.length ? 'statusLineFiltered' : 'statusLineIdle');
      return;
    }
    el.className = 'status live';
    el.textContent = t('statusLineWatching', [channels.join(', ')]);
    el.title = channels.join(', ');
  }

  // ------------------------------------------------------------ notice (self-check)
  const ISSUE_TTL = 2 * 3600e3;
  let shownIssue = null;
  function issueText(h) {
    const where = h.channel ? `twitch.tv/${h.channel}` : 'Twitch';
    if (h.issue === 'noWidget') return t('issueNoWidget', [where]);
    if (h.issue === 'noBonus') return t('issueNoBonus', [where]);
    const what = { points: 'issueWhatPoints', moments: 'issueWhatMoments', drops: 'issueWhatDrops' }[h.kind];
    return t('issueClickFailed', [t(what)]);
  }
  function renderNotice(health) {
    const list = Object.entries(health || {})
      .filter(([, h]) => h && Date.now() - h.at < ISSUE_TTL)
      .sort((a, b) => b[1].at - a[1].at);
    shownIssue = settings.enabled && list.length ? list[0][0] : null;
    $('notice').hidden = !shownIssue;
    if (shownIssue) $('noticeText').textContent = issueText(list[0][1]);
  }
  $('noticeClose').addEventListener('click', async () => {
    const { health = {} } = await chrome.storage.session.get('health');
    delete health[shownIssue];
    await chrome.storage.session.set({ health });
  });
  const loadNotice = () => chrome.storage.session.get('health').then(({ health }) => renderNotice(health));

  // ------------------------------------------------------------ overview
  function renderToday() {
    const today = stats.days[dayKey()] || { points: 0, moments: 0, drops: 0 };
    const value = $('todayPoints');
    value.textContent = fmt(today.points);
    if (lastToday != null && today.points > lastToday) {
      const wrap = value.parentElement;
      wrap.classList.remove('bump');
      void wrap.offsetWidth;
      wrap.classList.add('bump');
    }
    lastToday = today.points;
    $('todayExtra').textContent = t('todayExtra', [fmt(today.moments || 0), fmt(today.drops || 0)]);
    $('totalPoints').textContent = fmt(stats.total.points);
  }

  function lastDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      out.push({ key, date: d, value: (stats.days[key] && stats.days[key].points) || 0, isToday: i === 0 });
    }
    return out;
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
  }

  // ------------------------------------------------------------ chart period: 7 / 14 / 30 days
  const RANGES = [7, 14, 30];
  const rangeButtons = Array.from(document.querySelectorAll('#chartRange button'));
  let chartDays = 7;
  try { chartDays = RANGES.includes(+localStorage.getItem('glint-chart-days')) ? +localStorage.getItem('glint-chart-days') : 7; } catch (e) { /* ignore */ }
  function setChartDays(n) {
    chartDays = n;
    try { localStorage.setItem('glint-chart-days', String(n)); } catch (e) { /* ignore */ }
    renderChart();
  }
  rangeButtons.forEach((b, i) => {
    b.setAttribute('aria-label', t('chartRangeOption', [b.dataset.days]));
    b.addEventListener('click', () => setChartDays(+b.dataset.days));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = rangeButtons[(i + d + rangeButtons.length) % rangeButtons.length];
      setChartDays(+next.dataset.days);
      next.focus();
    });
  });

  function renderChart() {
    const title = t('chartTitle', [String(chartDays)]);
    $('chartTitle').textContent = title;
    rangeButtons.forEach(b => {
      const on = +b.dataset.days === chartDays;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('tooltip').hidden = true;

    const days = lastDays(chartDays);
    const W = 328, H = 150, top = 34, bottom = 22, plotH = H - top - bottom; // headroom for the tooltip
    const max = niceMax(Math.max(...days.map(d => d.value)));
    const slot = W / days.length;
    const barW = Math.min(18, slot * 0.62);
    // 7 days: weekdays; 14: every date; 30: every 5th date counting back from today
    const dayFmt = new Intl.DateTimeFormat(locale, chartDays === 7 ? { weekday: 'short' } : { day: 'numeric' });
    const labelled = i => chartDays !== 30 || (days.length - 1 - i) % 5 === 0;
    const fullFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);

    // recessive gridlines: baseline + half + max
    [0, 0.5, 1].forEach(f => {
      const y = top + plotH - plotH * f;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'gridline');
      line.setAttribute('x1', 0); line.setAttribute('x2', W);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      svg.appendChild(line);
    });

    const tip = $('tooltip');
    days.forEach((d, i) => {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'col');
      const cx = slot * i + slot / 2;
      const h = d.value ? Math.max(4, (d.value / max) * plotH) : 2;
      const y = top + plotH - h;
      const r = d.value ? Math.min(4, h / 2, barW / 2) : 1;
      const path = document.createElementNS(ns, 'path');
      const x0 = cx - barW / 2, x1 = cx + barW / 2, yb = top + plotH;
      // rounded data-end on top, square on the baseline
      path.setAttribute('d', `M${x0},${yb} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x1 - r} Q${x1},${y} ${x1},${y + r} V${yb} Z`);
      path.setAttribute('class', d.value ? 'bar' : 'bar-zero');
      g.appendChild(path);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('class', d.isToday ? 'axis today' : 'axis');
      label.setAttribute('x', cx);
      label.setAttribute('y', H - 6);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = dayFmt.format(d.date);
      labelled(i) && g.appendChild(label);

      const hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('class', 'hit');
      hit.setAttribute('x', slot * i); hit.setAttribute('y', 0);
      hit.setAttribute('width', slot); hit.setAttribute('height', H);
      hit.setAttribute('tabindex', '0');
      const text = `${fullFmt.format(d.date)}: ${fmt(d.value)} ${t('pointsUnit')}`;
      hit.setAttribute('aria-label', text);
      const show = () => {
        g.classList.add('active');
        tip.innerHTML = '';
        const b = document.createElement('b');
        b.textContent = fmt(d.value);
        tip.append(b, ` ${t('pointsUnit')}, ${fullFmt.format(d.date)}`);
        tip.hidden = false;
        const plot = $('chart').getBoundingClientRect();
        const fig = tip.parentElement.getBoundingClientRect();
        const scale = plot.width / W;
        let left = plot.left - fig.left + cx * scale;
        const half = tip.offsetWidth / 2;
        left = Math.min(Math.max(left, half), fig.width - half);
        tip.style.left = `${left}px`;
        tip.style.top = `${plot.top - fig.top + y * scale - 6}px`;
      };
      const hide = () => { g.classList.remove('active'); tip.hidden = true; };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      g.appendChild(hit);
      svg.appendChild(g);
    });
    $('chart').replaceChildren(svg);
  }

  // ------------------------------------------------------------ avatars
  // A circle with the channel's first letter; the Twitch avatar, if known, fades in on top.
  // If the picture can't load (offline, renamed), the letter simply stays.
  // Lists are rebuilt on every claim, so a picture that has loaded once is shown at once
  // afterwards: fading it in again each time made avatars blink.
  const loadedAvatars = new Set();
  function avatarEl(name) {
    const el = document.createElement('span');
    el.className = 'avatar';
    el.textContent = (name || '?').slice(0, 1).toUpperCase();
    const url = settings.avatars && avatars[name] && GLINT.avatarUrl(avatars[name].url);
    if (url) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      if (loadedAvatars.has(url)) img.classList.add('loaded', 'instant');
      img.addEventListener('load', () => { loadedAvatars.add(url); img.classList.add('loaded'); });
      img.addEventListener('error', () => img.remove());
      img.src = url;
      el.append(img);
    }
    return el;
  }

  function renderChannels() {
    const list = Object.entries(stats.channels)
      .map(([name, c]) => ({ name, points: c.points || 0, last: c.last || 0 }))
      .filter(c => c.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);
    const ol = $('channelList');
    ol.replaceChildren();
    $('channelsEmpty').hidden = list.length > 0;
    const max = list.length ? list[0].points : 1;
    list.forEach(c => {
      const li = document.createElement('li');
      li.className = 'channel';
      const avatar = avatarEl(c.name);
      const a = document.createElement('a');
      a.href = `https://www.twitch.tv/${c.name}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = c.name;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = fmt(c.points);
      const meter = document.createElement('span');
      meter.className = 'meter';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(2, (c.points / max) * 100)}%`;
      meter.appendChild(fill);
      li.append(avatar, a, num, meter);
      ol.appendChild(li);
    });
    renderAllChannels(); // skipped while the Channels tab is closed
  }

  // ------------------------------------------------------------ all channels (sub-screen)
  const SORTS = ['points', 'recent', 'name'];
  const sortButtons = Array.from(document.querySelectorAll('#channelSort button'));
  let channelSort = 'points';
  try { SORTS.includes(localStorage.getItem('glint-channel-sort')) && (channelSort = localStorage.getItem('glint-channel-sort')); } catch (e) { /* ignore */ }

  function allChannelEntries() {
    return Object.entries(stats.channels)
      .map(([name, c]) => ({ name, points: c.points || 0, moments: c.moments || 0, last: c.last || 0 }))
      .filter(c => c.points > 0 || c.moments > 0);
  }

  function whenText(ts) {
    if (!ts) return '';
    const k = dayKey(ts);
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ts);
    if (k === dayKey()) return `${t('dayToday')}, ${time}`;
    if (k === dayKey(Date.now() - 864e5)) return `${t('dayYesterday')}, ${time}`;
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(ts);
  }

  function renderAllChannels() {
    if ($('panel-channels').hidden) return;
    const all = allChannelEntries();
    $('allChannelsTitle').textContent = t('allChannelsTitle', [fmt(all.length)]);
    sortButtons.forEach(b => {
      const on = b.dataset.sort === channelSort;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const q = $('channelSearch').value.trim().toLowerCase().replace(/^@/, '');
    const cmp = {
      points: (a, b) => b.points - a.points || b.last - a.last,
      recent: (a, b) => b.last - a.last,
      name: (a, b) => a.name.localeCompare(b.name)
    }[channelSort];
    const list = all.filter(c => !q || c.name.includes(q)).sort(cmp);
    $('allChannelsEmpty').hidden = list.length > 0;
    $('allChannelList').replaceChildren(...list.map(c => {
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ch-row';
      row.title = t('channelHistory', [c.name]);
      const what = document.createElement('span');
      what.className = 'what';
      const b = document.createElement('b');
      b.textContent = c.name;
      const small = document.createElement('small');
      small.textContent = [whenText(c.last), c.moments ? t('channelMoments', [fmt(c.moments)]) : '']
        .filter(Boolean).join(' · ');
      what.append(b, small);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = fmt(c.points);
      row.append(avatarEl(c.name), what, num);
      row.addEventListener('click', () => showChannelHistory(c.name));
      li.append(row);
      return li;
    }));
  }

  $('channelSearch').addEventListener('input', renderAllChannels);
  sortButtons.forEach((b, i) => {
    const pick = s => {
      channelSort = s;
      try { localStorage.setItem('glint-channel-sort', s); } catch (e) { /* ignore */ }
      renderAllChannels();
    };
    b.addEventListener('click', () => pick(b.dataset.sort));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = sortButtons[(i + d + sortButtons.length) % sortButtons.length];
      pick(next.dataset.sort);
      next.focus();
    });
  });

  // ------------------------------------------------------------ history
  const ICONS = {
    points: '<path class="mark" d="M12 6.5l1.5 3.6 3.9.3-3 2.5.9 3.8L12 14.6l-3.3 2.1.9-3.8-3-2.5 3.9-.3z"/>',
    moments: '<rect class="mark" x="7" y="7" width="10" height="10" rx="2"/><circle class="mark" cx="12" cy="12" r="1.6"/>',
    drops: '<path class="mark" d="M12 6c2.4 3 3.8 5.1 3.8 6.9a3.8 3.8 0 0 1-7.6 0C8.2 11.1 9.6 9 12 6z"/>'
  };

  function renderHistory() {
    const box = $('historyList');
    box.replaceChildren();
    const items = history.filter(h => (historyKind === 'all' || h.kind === historyKind) &&
      (!historyChannel || h.channel === historyChannel));
    $('historyEmpty').hidden = items.length > 0;
    $('historyChannelBar').hidden = !historyChannel;
    $('historyChannelText').textContent = historyChannel ? t('historyChannel', [historyChannel]) : '';
    const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const todayK = dayKey();
    const yesterdayK = dayKey(Date.now() - 864e5);
    let currentDay = '';
    // a single type shows everything that's stored for it
    items.slice(0, GLINT.HISTORY_MAX).forEach(h => {
      const k = dayKey(h.at);
      if (k !== currentDay) {
        currentDay = k;
        const h3 = document.createElement('h3');
        h3.textContent = k === todayK ? t('dayToday') : k === yesterdayK ? t('dayYesterday') : dayFmt.format(h.at);
        box.appendChild(h3);
      }
      const row = document.createElement('div');
      row.className = 'event';
      row.innerHTML = `<svg class="kind-icon" viewBox="0 0 24 24" aria-hidden="true"><circle class="face" cx="12" cy="12" r="12"/>${ICONS[h.kind] || ''}</svg><div class="what"><b></b><small></small></div><time></time>`;
      // with a known avatar: the channel's picture, and the event type as a small badge on it
      if (h.channel && settings.avatars && avatars[h.channel]) {
        const pic = document.createElement('span');
        pic.className = 'event-pic';
        const badge = row.querySelector('.kind-icon');
        badge.classList.add('badge');
        pic.append(avatarEl(h.channel), badge);
        row.prepend(pic);
      }
      const title = h.kind === 'points'
        ? `${h.approx ? '≈' : '+'}${fmt(h.amount)} ${t('pointsUnit')}`
        : t(h.kind === 'drops' ? 'eventDrop' : 'eventMoment');
      row.querySelector('b').textContent = title;
      row.querySelector('small').textContent = [h.title, h.channel].filter(Boolean).join(', ') || 'Twitch';
      const time = row.querySelector('time');
      time.dateTime = new Date(h.at).toISOString();
      time.textContent = timeFmt.format(h.at);
      box.appendChild(row);
    });
  }

  // history of one channel, opened from the "all channels" screen
  function showChannelHistory(name) {
    historyChannel = name;
    selectTab($('tab-history'));
    renderHistory();
    document.querySelector('main').scrollTop = 0;
  }
  $('historyChannelClear').addEventListener('click', () => {
    historyChannel = '';
    renderHistory();
  });

  const filterButtons = Array.from(document.querySelectorAll('#historyFilter button'));
  filterButtons.forEach(b => b.addEventListener('click', () => {
    historyKind = b.dataset.kind;
    filterButtons.forEach(x => x.setAttribute('aria-checked', String(x === b)));
    renderHistory();
  }));

  // ------------------------------------------------------------ data actions
  $('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['stats', 'history']);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `glint-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  const resetBtn = $('resetBtn');
  let resetArmed = null;
  resetBtn.addEventListener('click', async () => {
    if (!resetArmed) {
      resetBtn.classList.add('confirm');
      resetBtn.textContent = t('resetConfirm');
      resetArmed = setTimeout(() => {
        resetArmed = null;
        resetBtn.classList.remove('confirm');
        resetBtn.textContent = t('resetStats');
      }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    await chrome.storage.local.set({ stats: emptyStats(), history: [] });
    resetBtn.classList.remove('confirm');
    resetBtn.textContent = t('resetDone');
    setTimeout(() => { resetBtn.textContent = t('resetStats'); }, 2000);
  });

  // ------------------------------------------------------------ data load
  function renderAll() {
    renderSettings();
    renderToday();
    renderChart();
    renderChannels();
    renderHistory();
    renderStatus();
    loadNotice();
  }

  Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get(['stats', 'history', 'avatars'])])
    .then(([sync, local]) => {
      settings = { ...DEFAULT_SETTINGS, ...(sync.settings || {}) };
      stats = { ...emptyStats(), ...(local.stats || {}) };
      history = local.history || [];
      avatars = local.avatars || {};
      renderAll();
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      renderSettings();
      renderStatus();
      loadNotice();
      if (changes.settings.oldValue?.avatars !== settings.avatars) {
        renderChannels();
        renderHistory();
      }
    }
    if (area === 'session' && changes.health) renderNotice(changes.health.newValue);
    if (area === 'local' && changes.avatars) {
      avatars = changes.avatars.newValue || {};
      renderChannels();
      renderHistory();
    }
    if (area === 'local' && (changes.stats || changes.history)) {
      if (changes.stats) stats = { ...emptyStats(), ...(changes.stats.newValue || {}) };
      if (changes.history) history = changes.history.newValue || [];
      renderToday();
      renderChart();
      renderChannels();
      renderHistory();
    }
  });

})();
