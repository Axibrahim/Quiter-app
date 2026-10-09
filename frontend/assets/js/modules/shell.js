/**
 * Page shell — every page calls initShell() once. It adds the background video,
 * the navigation, the auth modal and scroll-reveal, so no page repeats them.
 *
 *   const user = await initShell({ active: 'dashboard', auth: 'required' });
 *
 * auth: 'required'  -> logged-out visitors are sent to the login modal
 *       'optional'  -> page works for everyone (default)
 *       'none'      -> don't even check the session (verify / reset / email check-in)
 */
import { initBackground } from '../bg-video.js';
import { loadUser, logout, sessionCheckWasOffline } from './auth-state.js';
import { initPWA } from '../pwa.js';
import { initAuthModal, openAuthModal } from './auth-modal.js';


const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="10" r="3"/><path d="M12 13v9M12 7V2M9 10H4M20 10h-5M9.9 7.9 6.5 4.5M17.5 4.5l-3.4 3.4"/></svg>`;

function link(href, label, key, active) {
  return `<a href="${href}"${key === active ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`;
}

function renderNav(user, active, offline = false) {
  const links = [
    link('plans.html', 'Start a plan', 'plans', active),
    ...(user ? [link('dashboard.html', 'Dashboard', 'dashboard', active)] : [link('index.html#how', 'How it works', 'how', active)]),
  ].join('');

  const right = offline ? ''
    : user
    ? `${user.is_admin ? '<a class="btn btn--text btn--sm" href="admin.html">Admin</a>' : ''}
       <a class="btn btn--glass btn--sm liquid-glass" href="profile.html">${(user.display_name || 'Me').split(' ')[0]}</a>`
    : `<button class="btn btn--text btn--sm" type="button" data-open-auth="login">Log in</button>
       <button class="btn btn--solid btn--sm" type="button" data-open-auth="signup">Get started</button>`;

  const nav = document.createElement('header');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav__pill liquid-glass">
      <div class="nav__left">
        <a class="nav__mark" href="${user ? 'dashboard.html' : 'index.html'}">${MARK}<span>Quiter</span></a>
        <nav class="nav__links" aria-label="Main">${links}</nav>
      </div>
      <div class="nav__right">${right}
        <button class="icon-btn nav__toggle" type="button" aria-label="Menu" aria-expanded="false">☰</button>
      </div>
    </div>
    <nav class="nav__panel liquid-glass liquid-glass--panel" aria-label="Mobile">${links}</nav>`;
  document.body.prepend(nav);

  const toggle = nav.querySelector('.nav__toggle');
  const panel = nav.querySelector('.nav__panel');
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) panel.classList.remove('is-open'); });
}

function initReveal() {
  const items = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-visible')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

function showOfflineNotice() {
  const main = document.querySelector('main') || document.body;
  const box = document.createElement('div');
  box.className = 'offline-notice liquid-glass liquid-glass--panel';
  box.setAttribute('role', 'status');
  box.innerHTML = `<h2 class="h3">You're offline</h2>
    <p>Quiter needs a connection to load your plans. Reconnect and this page refreshes by itself.</p>
    <button class="btn btn--solid btn--sm" type="button">Try again</button>`;
  box.querySelector('button').addEventListener('click', () => location.reload());
  main.classList.add('is-offline');          // CSS hides the empty page skeleton behind the notice
  main.prepend(box);
  window.addEventListener('online', () => location.reload());
}

export async function initShell({ active = '', auth = 'optional' } = {}) {
  document.documentElement.classList.add('js');
  initBackground();

  initPWA({ hint: auth !== 'none' });

  const user = auth === 'none' ? null : await loadUser();
  const offline = !user && auth !== 'none' && sessionCheckWasOffline();
  renderNav(user, active, offline);
  initAuthModal();

  // Any element with data-open-auth opens the modal; data-requires-auth links
  // ask logged-out visitors to log in first, then continue to their destination.
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-auth]');
    if (opener) { e.preventDefault(); openAuthModal(opener.dataset.openAuth); return; }
    const gated = e.target.closest('[data-requires-auth]');
    if (gated && !user) { e.preventDefault(); openAuthModal('signup', gated.getAttribute('href')); }
  });

  if (auth === 'required' && !user && offline) {
    // No connection is not the same as logged out: keep the page, say so, and come back when we're online.
    showOfflineNotice();
    return null;
  }

  if (auth === 'required' && !user) {
    window.location.replace(`index.html?login=1&next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    return null;
  }
  initReveal();
  return user;
}