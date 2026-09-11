/**
 * Shared responsive navbar.
 *
 * Desktop: keeps the existing navbar layout.
 * Mobile: moves nav links into a glass dropdown panel. The auth/user
 * area (login buttons or the username pill) stays visible in the bar
 * next to the menu toggle rather than being hidden inside the panel.
 */

function initMobileNav() {
  const pill = document.querySelector('.nav__pill');
  const navLeft = pill?.querySelector('.nav__left');
  const navLinks = pill?.querySelector('.nav__links');
  const navRight = pill?.querySelector('.nav__right');

  if (!pill || !navLeft || !navLinks || !navRight) return;
  if (pill.querySelector('.nav__menu-toggle')) return;

  const panel = document.createElement('div');
  panel.className = 'nav__mobile-panel';
  panel.id = 'mobile-nav-panel';

  const toggle = document.createElement('button');
  toggle.className = 'nav__menu-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mobile-nav-panel');
  toggle.setAttribute('aria-label', 'Open navigation menu');

  const menuIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true"
         fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round">
      <path d="M4 7h16M4 12h16M4 17h16"/>
    </svg>
  `;

  const closeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true"
         fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>
  `;

  toggle.innerHTML = menuIcon;

  // Move only the nav links into the dropdown. The auth/user area
  // (navRight) stays put in the bar so the username stays visible.
  panel.append(navLinks);

  // The panel is appended to the <header class="nav">, NOT the pill.
  // .nav__pill carries the shared .liquid-glass class, which sets
  // overflow: hidden (needed for its shine-reflection effect) — if the
  // dropdown lived inside the pill, that overflow would clip it
  // completely invisible even while correctly "open". The header itself
  // has no overflow restriction, so the panel escapes the clipping while
  // still positioning right under the pill.
  const navHeader = pill.closest('.nav') || pill.parentElement;
  pill.append(toggle);
  navHeader.append(panel);

  const closeMenu = () => {
    panel.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = menuIcon;
  };

  const openMenu = () => {
    panel.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
    toggle.innerHTML = closeIcon;
  };

  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.contains('is-open');

    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (event) => {
    if (!navHeader.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) {
      closeMenu();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileNav);
} else {
  initMobileNav();
}