/**
 * PWA glue: service worker registration, standalone detection and the
 * "Add to Home Screen" hint (iOS has no install prompt, so we explain it;
 * Chrome/Android get a real Install button).
 *
 * initPWA({ hint: true }) is called by the shell on every normal page.
 */
const DISMISS_KEY = 'quiter_install_hint_dismissed';
const DISMISS_DAYS = 30;
const SHOW_AFTER_MS = 6000;

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac, but has a touch screen.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function inAppBrowser() {
  return /(FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|MicroMessenger)/i.test(navigator.userAgent || '');
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

function rememberDismissed() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- service worker

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service workers only run on https:// (or localhost). Anywhere else this is a harmless no-op.
  if (!window.isSecureContext) return;

  const swUrl = new URL('../../sw.js', import.meta.url);         // <site root>/sw.js, works on sub-paths too
  navigator.serviceWorker.register(swUrl).then((reg) => {
    // An installed iOS app can stay open for days: check for a new version whenever it comes back to the foreground.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - lastCheck < 10 * 60 * 1000) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('[pwa] service worker not registered:', err.message));
}

// ---------------------------------------------------------------- install hint

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;

function showHint({ html, action }) {
  if (document.querySelector('.install-hint')) return;
  const el = document.createElement('aside');
  el.className = 'install-hint liquid-glass liquid-glass--panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Install Quiter');
  el.innerHTML = `
    <div class="install-hint__text">${html}</div>
    ${action ? `<button class="btn btn--solid btn--sm" type="button" data-install>${action}</button>` : ''}
    <button class="icon-btn" type="button" data-dismiss aria-label="Dismiss">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  el.querySelector('[data-dismiss]').addEventListener('click', () => { rememberDismissed(); el.remove(); });
  return el;
}

function setupInstallHint() {
  if (isStandalone() || recentlyDismissed() || inAppBrowser()) return;

  if (isIOS()) {
    setTimeout(() => showHint({
      html: `<strong>Install Quiter</strong><span>Tap ${SHARE_ICON} then <b>Add to Home Screen</b> to open it like an app.</span>`,
    }), SHOW_AFTER_MS);
    return;
  }

  // Chrome / Edge / Android: use the real install prompt.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setTimeout(() => {
      const el = showHint({ html: '<strong>Install Quiter</strong><span>Add it to your home screen for one-tap access.</span>', action: 'Install' });
      el?.querySelector('[data-install]')?.addEventListener('click', async () => {
        el.remove();
        e.prompt();
        await e.userChoice.catch(() => {});
      });
    }, SHOW_AFTER_MS);
  }, { once: true });
  window.addEventListener('appinstalled', () => document.querySelector('.install-hint')?.remove());
}

// ---------------------------------------------------------------- entry

export function initPWA({ hint = true } = {}) {
  const standalone = isStandalone();
  document.documentElement.classList.toggle('is-standalone', standalone);
  registerServiceWorker();
  if (hint) setupInstallHint();
}
