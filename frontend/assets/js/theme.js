/**
 * Theme switch: "light" | "dark". No saved choice = follow the device setting.
 * theme-boot.js (in <head>) applies the theme before paint; this module owns the toggle + changes.
 * Other code can react with:  addEventListener('quiter:theme', (e) => e.detail.theme)
 */
const KEY = 'quiter-theme';
const root = document.documentElement;
const mq = matchMedia('(prefers-color-scheme: light)');

const SUN = '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z"/></svg>';

export const getTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark');

function apply(theme, { save = false } = {}) {
  const run = () => {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#e9ecf6' : '#000000');
    document.querySelectorAll('[data-theme-toggle]').forEach(syncButton);
    dispatchEvent(new CustomEvent('quiter:theme', { detail: { theme } }));
  };
  if (save) { try { localStorage.setItem(KEY, theme); } catch { /* private mode */ } }
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run);
  else run();
}

export function setTheme(theme) { apply(theme === 'light' ? 'light' : 'dark', { save: true }); }

function syncButton(btn) {
  const light = getTheme() === 'light';
  btn.setAttribute('aria-pressed', String(light));
  btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  btn.title = light ? 'Dark mode' : 'Light mode';
}

/** HTML for the nav button (shell.js puts it in .nav__right). */
export function themeToggleHTML() {
  return `<button class="icon-btn theme-toggle" type="button" data-theme-toggle>${MOON}${SUN}</button>`;
}

let bound = false;
export function initTheme() {
  document.querySelectorAll('[data-theme-toggle]').forEach(syncButton);
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) setTheme(getTheme() === 'light' ? 'dark' : 'light');
  });
  // follow the device while the visitor hasn't chosen
  mq.addEventListener?.('change', () => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (saved !== 'light' && saved !== 'dark') apply(mq.matches ? 'light' : 'dark');
  });
}