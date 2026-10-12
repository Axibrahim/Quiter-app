/**
 * Home: every info card (How it works, Two ways to train, Meet Blue) shows only a title and one
 * short line. Tap a card and it grows into a blurred detail panel — the same transition the
 * ready-made plans swiper uses (reuses the .spot-overlay / .spot-panel styles).
 *
 * To edit a card's text, change the markup in index.html: the short line is .card__short and the
 * long text lives in the hidden .card__detail block inside the card.
 */
import { pulseGL } from './site-gl.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const R = 28;
const FULL = `inset(0px 0px 0px 0px round ${R}px)`;
const insetFrom = (a, b) => `inset(${a.top - b.top}px ${b.right - a.right}px ${b.bottom - a.bottom}px ${a.left - b.left}px round ${R}px)`;

function panelHtml(card) {
  const title = card.querySelector('.card__title, .choice__title')?.textContent.trim() || '';
  const detail = card.querySelector('.card__detail')?.innerHTML || '';
  const { eyebrow, ctaLabel, ctaHref } = card.dataset;
  const auth = card.hasAttribute('data-cta-auth') ? ' data-requires-auth' : '';
  return `
  <div class="spot-panel spot-panel--text liquid-glass liquid-glass--panel" role="dialog" aria-modal="true" aria-labelledby="card-panel-title">
    <button class="icon-btn spot-panel__close" type="button" data-close aria-label="Close">✕</button>
    <div class="spot-panel__body">
      ${eyebrow ? `<p class="eyebrow" style="--i:0">${esc(eyebrow)}</p>` : ''}
      <h3 class="spot-panel__title" id="card-panel-title" style="--i:1">${esc(title)}</h3>
      <div class="card-detail" style="--i:2">${detail}</div>
      <div class="spot-panel__actions" style="--i:3">
        ${ctaHref ? `<a class="btn btn--solid" href="${esc(ctaHref)}"${auth}>${esc(ctaLabel || 'Get started')}</a>` : ''}
        <button class="btn btn--glass liquid-glass" type="button" data-close>Close</button>
      </div>
    </div>
  </div>`;
}

export function initHomeCards() {
  const cards = [...document.querySelectorAll('[data-card]')];
  if (!cards.length) return;

  document.body.insertAdjacentHTML('beforeend', '<div class="spot-overlay" id="card-overlay"></div>');
  const overlay = document.getElementById('card-overlay');
  let current = null;

  const isPhone = () => matchMedia('(max-width: 760px)').matches;

  function open(card) {
    if (current) return;
    const from = card.getBoundingClientRect();
    overlay.innerHTML = panelHtml(card);
    const panel = overlay.firstElementChild;
    const to = panel.getBoundingClientRect();
    const dur = reduce ? 0 : 620;

    document.documentElement.classList.add('is-locked');
    overlay.classList.add('is-open');
    if (isPhone()) {
      // phones: slide up like a sheet (transform + opacity only = smooth). The card is usually far from
      // the sheet at the bottom of the screen, so growing out of the card looked broken.
      panel.animate([{ transform: 'translate3d(0, 56px, 0) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: reduce ? 0 : 460, easing: 'cubic-bezier(.22,1,.36,1)' });
    } else {
      panel.animate([{ clipPath: insetFrom(from, to) }, { clipPath: FULL }], { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' });
      panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.35, easing: 'ease-out' });
    }

    current = card;
    pulseGL();
    panel.querySelector('[data-close]').focus({ preventScroll: true });
  }

  function close() {
    if (!current) return;
    const card = current;
    const panel = overlay.firstElementChild;
    const from = card.getBoundingClientRect(), to = panel.getBoundingClientRect();

    overlay.classList.remove('is-open');
    document.documentElement.classList.remove('is-locked');
    current = null;

    const anim = isPhone()
      ? panel.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, 48px, 0) scale(.97)', opacity: 0 }],
          { duration: reduce ? 0 : 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      : panel.animate([{ clipPath: FULL }, { clipPath: insetFrom(from, to) }],
          { duration: reduce ? 0 : 420, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    anim.onfinish = () => {
      if (!current) overlay.innerHTML = '';
      card.focus({ preventScroll: true });
    };
  }

  cards.forEach((card) => {
    card.addEventListener('click', () => open(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
    });
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...overlay.querySelectorAll('button, a[href]')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}