/* © 2026 DENVER. All rights reserved. See LICENSE. */
/* Glint popup logic. */
(() => {
  'use strict';
  const { DEFAULT_SETTINGS, dayKey, emptyStats } = GLINT;
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  const $ = id => document.getElementById(id);
  const locale = chrome.i18n.getUILanguage();
  const fmt = n => Number(n || 0).toLocaleString(locale);
  // From 100 000 on: 123к / 1,2 млн (rounded down, never overstated). Exact value goes in a title.
  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  function fmtShort(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (n < 1e5) return fmt(n);
    if (n < 1e6) return t('shortThousands', [fmt(Math.floor(n / 1e3))]);
    return t('shortMillions', [oneDecimal.format(Math.floor(n / 1e5) / 10)]);
  }
  /** Put a possibly shortened number into an element, with the exact one on hover. */
  function setNumber(el, n) {
    const short = fmtShort(n);
    el.textContent = short;
    if (short !== fmt(n)) el.title = fmt(n);
    else el.removeAttribute('title');
  }

  let settings = { ...DEFAULT_SETTINGS };
  let stats = emptyStats();
  let history = [];
  let avatars = {};
  let historyKind = 'all';
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
  // the popup always opens on "Overview"; the last tab used to be remembered (1.6.5 and older)
  try { localStorage.removeItem('glint-tab'); } catch (e) { /* ignore */ }

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
  // "Report a problem": a plain link to a prefilled GitHub issue. Nothing is sent by Glint itself;
  // the user sees the text on GitHub first. Only technical details go in, never channels or stats.
  const ISSUES_URL = 'https://github.com/Tekutorukushi/glint/issues/new';
  function reportUrl(h) {
    const lines = [
      `### ${t('reportWhat')}`, '', '', `### ${t('reportSteps')}`, '', '',
      '### Glint',
      `- version: ${chrome.runtime.getManifest().version}`,
      `- browser: ${navigator.userAgent}`,
      `- language: ${chrome.i18n.getUILanguage()}`,
    ];
    if (h) lines.push(`- self-check: ${h.issue}${h.kind ? ` (${h.kind})` : ''}`);
    const title = h ? `Self-check: ${h.issue}${h.kind ? ` (${h.kind})` : ''}` : '';
    return `${ISSUES_URL}?${new URLSearchParams({ title, body: lines.join('\n') })}`;
  }
  $('reportLink').href = reportUrl(null);

  function renderNotice(health) {
    const list = Object.entries(health || {})
      .filter(([, h]) => h && Date.now() - h.at < ISSUE_TTL)
      .sort((a, b) => b[1].at - a[1].at);
    shownIssue = settings.enabled && list.length ? list[0][0] : null;
    $('notice').hidden = !shownIssue;
    if (shownIssue) {
      $('noticeText').textContent = issueText(list[0][1]);
      $('noticeReport').href = reportUrl(list[0][1]);
    }
  }
  $('noticeClose').addEventListener('click', async () => {
    const { health = {} } = await chrome.storage.session.get('health');
    delete health[shownIssue];
    await chrome.storage.session.set({ health });
  });
  const loadNotice = () => chrome.storage.session.get('health').then(({ health }) => renderNotice(health));

  // ------------------------------------------------------------ tabs opened before an update
  // After "Update" on the extensions page, already open Twitch tabs keep the old, disconnected
  // script and collect nothing until reloaded. Ping each tab's script; silent or outdated = stale.
  const plural = new Intl.PluralRules(locale);
  let staleTabs = [];
  async function checkStaleTabs() {
    const version = chrome.runtime.getManifest().version;
    const tabsOpen = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
    const ping = tab => Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'ping' }, { frameId: 0 }).then(r => r && r.version === version, () => false),
      new Promise(r => setTimeout(() => r(false), 1500))
    ]);
    // tabs still loading or unloaded by the browser will start the current version themselves
    const live = tabsOpen.filter(tab => !tab.discarded && tab.status === 'complete');
    const ok = await Promise.all(live.map(ping));
    staleTabs = live.filter((tab, i) => !ok[i]).map(tab => tab.id);
    const n = staleTabs.length;
    $('staleNotice').hidden = !n;
    if (n) {
      const key = `staleText_${plural.select(n)}`;
      $('staleText').textContent = chrome.i18n.getMessage(key, [String(n)]) || t('staleText_other', [String(n)]);
    }
  }
  $('staleReload').addEventListener('click', async () => {
    const btn = $('staleReload');
    btn.disabled = true;
    await Promise.all(staleTabs.map(id => chrome.tabs.reload(id).catch(() => {})));
    setTimeout(() => { btn.disabled = false; checkStaleTabs(); }, 4000);
  });

  // ------------------------------------------------------------ overview
  // Moments and drops as two small icon + number pairs (same icons as in History); the full
  // sentence ("Moments: 2, drops: 1") is the tooltip and what screen readers hear.
  function setExtra(el, moments, drops) {
    const full = t('todayExtra', [fmt(moments || 0), fmt(drops || 0)]);
    el.title = full;
    el.innerHTML =
      `<span class="stat" aria-hidden="true"><svg viewBox="5 5 14 14">${ICONS.moments}</svg><span></span></span>` +
      `<span class="stat" aria-hidden="true"><svg viewBox="5 5 14 14">${ICONS.drops}</svg><span></span></span>` +
      '<span class="sr-only"></span>';
    const nums = el.querySelectorAll('.stat > span');
    nums[0].textContent = fmtShort(moments);
    nums[1].textContent = fmtShort(drops);
    el.querySelector('.sr-only').textContent = full;
  }

  function renderToday() {
    const today = stats.days[dayKey()] || { points: 0, moments: 0, drops: 0 };
    const value = $('todayPoints');
    setNumber(value, today.points);
    if (lastToday != null && today.points > lastToday) {
      const wrap = value.parentElement;
      wrap.classList.remove('bump');
      void wrap.offsetWidth;
      wrap.classList.add('bump');
    }
    lastToday = today.points;
    setExtra($('todayExtra'), today.moments, today.drops);
    setNumber($('totalPoints'), stats.total.points);
    setExtra($('totalExtra'), stats.total.moments, stats.total.drops);
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
      setNumber(num, c.points);
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
      const row = document.createElement('a');
      row.className = 'ch-row';
      row.href = `https://www.twitch.tv/${c.name}`;
      row.target = '_blank';
      row.rel = 'noopener';
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
      setNumber(num, c.points);
      row.append(avatarEl(c.name), what, num);
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
    // the search looks at the channel and at the drop or moment title
    const q = $('historySearch').value.trim().toLowerCase().replace(/^@/, '');
    const ofKind = history.filter(h => historyKind === 'all' || h.kind === historyKind);
    const items = q ? ofKind.filter(h => `${h.channel || ''}\n${h.title || ''}`.toLowerCase().includes(q)) : ofKind;
    $('historyEmpty').hidden = ofKind.length > 0;
    $('historyNothing').hidden = !ofKind.length || items.length > 0;
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

  $('historySearch').addEventListener('input', renderHistory);

  const filterButtons = Array.from(document.querySelectorAll('#historyFilter button'));
  filterButtons.forEach(b => b.addEventListener('click', () => {
    historyKind = b.dataset.kind;
    filterButtons.forEach(x => x.setAttribute('aria-checked', String(x === b)));
    renderHistory();
  }));

  // ------------------------------------------------------------ data actions
  $('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['stats', 'history']);
    const meta = { app: 'glint', version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify({ ...meta, ...data }, null, 2)], { type: 'application/json' });
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
    // through the background's write queue, so a claim being recorded right now can't undo it
    await chrome.runtime.sendMessage({ type: 'replaceStats', data: { stats: emptyStats(), history: [] }, reset: true });
    resetBtn.classList.remove('confirm');
    resetBtn.textContent = t('resetDone');
    setTimeout(() => { resetBtn.textContent = t('resetStats'); }, 2000);
  });

  // Import: pick a file exported earlier, see what's in it, then confirm replacing current stats.
  let pendingImport = null;
  function showImport(text, canReplace) {
    $('importBox').hidden = false;
    $('importText').textContent = text;
    $('importConfirm').hidden = !canReplace;
    $('importCancel').textContent = t(canReplace ? 'importCancel' : 'importClose');
  }
  function hideImport() {
    pendingImport = null;
    $('importBox').hidden = true;
    $('importFile').value = '';
  }
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const file = $('importFile').files[0];
    if (!file) return;
    let clean = null;
    try {
      if (file.size < 20e6) clean = GLINT.sanitizeImport(JSON.parse(await file.text()));
    } catch (e) { /* not JSON */ }
    if (!clean) return showImport(t('importBad'), false);
    pendingImport = clean;
    const when = clean.exportedAt
      ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(clean.exportedAt)
      : file.name;
    showImport(t('importPreview', [when, fmt(clean.stats.total.points), fmt(Object.keys(clean.stats.channels).length),
      fmt(clean.history.length)]), true);
  });
  $('importCancel').addEventListener('click', hideImport);
  $('importConfirm').addEventListener('click', async () => {
    if (!pendingImport) return;
    const res = await chrome.runtime.sendMessage({ type: 'replaceStats', data: pendingImport }).catch(() => null);
    pendingImport = null;
    $('importFile').value = '';
    showImport(t(res && res.ok ? 'importDone' : 'importBad'), false);
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
    checkStaleTabs();
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
