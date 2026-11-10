/*
 * Runs in the page's own context (MAIN world) at document_start.
 * Makes Twitch believe the tab is visible, so the stream is not paused or
 * downgraded in background tabs. Controlled by the content script.
 */
(() => {
  'use strict';
  // last value saved by the content script; on by default until it says otherwise
  let keepAlive = true;
  try { keepAlive = localStorage.getItem('glint-keepalive') !== '0'; } catch (e) { /* ignore */ }

  const proto = Document.prototype;
  const visDesc = Object.getOwnPropertyDescriptor(proto, 'visibilityState');
  const hidDesc = Object.getOwnPropertyDescriptor(proto, 'hidden');
  if (!visDesc || !hidDesc) return;

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get() { return keepAlive ? 'visible' : visDesc.get.call(this); }
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get() { return keepAlive ? false : hidDesc.get.call(this); }
  });

  const swallow = e => { keepAlive && e.stopImmediatePropagation(); };
  document.addEventListener('visibilitychange', swallow, true);
  document.addEventListener('webkitvisibilitychange', swallow, true);

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.glint !== 'config') return;
    keepAlive = !!e.data.keepAlive;
  });
})();
