/**
 * Home: ready-made plans (max 6, added by admins) as a spotlight swiper.
 * The centred card is sharp, the rest are dimmed. Tap the centred card to open a
 * blurred detail view (photo left / text right on desktop, photo on top on phones).
 */
import { api } from './modules/api-client.js';
import { setGLAccent, pulseGL } from './site-gl.js';   // the stars now live site-wide (site-gl.js)

const CURRENCY = 'USD';   // used only when an admin sets a price
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isUrl = (u) => /^https?:\/\//i.test(u || '');

let templates = [], items = [], dotEls = [];
let track, overlay, prevBtn, nextBtn;
let active = -1, openIndex = -1, raf = 0;

const price = (t) => {
  if (t.is_included) return 'Included';
  if (t.price_cents > 0) return new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY }).format(t.price_cents / 100);
  return 'Free';
};

const specs = (t) => [
  ['Duration', `${t.length_days} days`],
  ['Type', t.direction === 'break' ? 'Break a habit' : 'Build a habit'],
  ['Category', t.category || 'General'],
  t.age_rating ? ['Age rating', t.age_rating] : null,
  t.trial_days > 0 ? ['Free trial', `${t.trial_days} days`] : null,
  ['Price', price(t)],
].filter(Boolean);

const photo = (t, cls) => isUrl(t.photo_url)
  ? `<img class="${cls}" src="${esc(t.photo_url)}" alt="" loading="${cls === 'spot-card__photo' ? 'eager' : 'lazy'}" decoding="async">`
  : `<span class="${cls} spot-card__photo--empty" aria-hidden="true"></span>`;

const cardHtml = (t, i) => `
  <li class="spot__item" data-i="${i}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${templates.length}">
    <button class="spot-card liquid-glass liquid-glass--panel" type="button" aria-haspopup="dialog">
      ${photo(t, 'spot-card__photo')}
      <span class="spot-card__shade"></span>
      <span class="spot-card__meta"><span class="badge">${t.length_days} days</span><span class="badge">${esc(t.category || 'Plan')}</span></span>
      <span class="spot-card__body">
        <span class="spot-card__title">${esc(t.title)}</span>
        <span class="spot-card__tag">${esc(t.tagline || t.identity_statement || '')}</span>
        <span class="spot-card__hint">View details</span>
      </span>
    </button>
  </li>`;

const panelHtml = (t) => `
  <div class="spot-panel liquid-glass liquid-glass--panel" role="dialog" aria-modal="true" aria-labelledby="spot-title">
    <button class="icon-btn spot-panel__close" type="button" data-close aria-label="Close">✕</button>
    <div class="spot-panel__photo">${photo(t, 'spot-panel__img')}</div>
    <div class="spot-panel__body">
      <p class="eyebrow" style="--i:0">${esc(t.category || 'Plan')} · ${t.length_days} days</p>
      <h3 class="spot-panel__title" id="spot-title" style="--i:1">${esc(t.title)}</h3>
      ${t.identity_statement ? `<p class="spot-panel__identity" style="--i:2">${esc(t.identity_statement)}</p>` : ''}
      ${t.description ? `<p style="--i:3">${esc(t.description)}</p>` : ''}
      <dl class="spot-specs" style="--i:4">${specs(t).map(([k, v]) =>
        `<div class="spot-spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="spot-panel__actions" style="--i:5">
        <a class="btn btn--solid" href="plans.html#start=${esc(t.id)}">${esc(t.cta_text || 'Start this plan')}</a>
        <button class="btn btn--glass liquid-glass" type="button" data-close>Close</button>
      </div>
    </div>
  </div>`;

// ---- carousel ---------------------------------------------------------------
// Card centres are measured once (not on every scroll event) so scrolling never forces layout.
let centers = [], step = 1, half = 0;
function measure() {
  centers = items.map((el) => el.offsetLeft + el.offsetWidth / 2);
  step = centers.length > 1 ? centers[1] - centers[0] : (items[0]?.offsetWidth || 1);
  half = track.clientWidth / 2;
}

// Runs once per frame while scrolling: each card scales/fades continuously with its
// distance from the centre (CSS reads --dist) instead of snapping between two states.
function update() {
  const mid = track.scrollLeft + half;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < items.length; i++) {
    const d = Math.abs(centers[i] - mid);
    items[i].style.setProperty('--dist', Math.min(1, d / step).toFixed(3));
    if (d < bestD) { bestD = d; best = i; }
  }
  markActive(best);
}

function markActive(i) {
  if (i === active) return;
  active = i;
  items.forEach((el, k) => el.classList.toggle('is-active', k === i));
  dotEls.forEach((el, k) => { el.classList.toggle('is-on', k === i); k === i ? el.setAttribute('aria-current', 'true') : el.removeAttribute('aria-current'); });
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === items.length - 1;
  setGLAccent(i);
}

function centerOn(i, instant = false) {
  i = Math.max(0, Math.min(items.length - 1, i));
  const el = items[i];
  track.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2, behavior: instant || reduce ? 'auto' : 'smooth' });
}

// ---- detail view (card grows into the panel over a blurred backdrop) ---------
const R = 28;
const FULL = `inset(0px 0px 0px 0px round ${R}px)`;
const insetFrom = (a, b) => `inset(${a.top - b.top}px ${b.right - a.right}px ${b.bottom - a.bottom}px ${a.left - b.left}px round ${R}px)`;

function openPanel(i) {
  const card = items[i].querySelector('.spot-card');
  const from = card.getBoundingClientRect();

  overlay.innerHTML = panelHtml(templates[i]);
  const panel = overlay.firstElementChild;
  const to = panel.getBoundingClientRect();

  const dur = reduce ? 0 : 620;
  document.documentElement.classList.add('is-locked');
  overlay.classList.add('is-open');
  panel.animate([{ clipPath: insetFrom(from, to) }, { clipPath: FULL }], { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' });
  panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.35, easing: 'ease-out' });

  openIndex = i;
  pulseGL();
  panel.querySelector('[data-close]').focus({ preventScroll: true });
}

function closePanel() {
  if (openIndex < 0) return;
  const card = items[openIndex].querySelector('.spot-card');
  const panel = overlay.firstElementChild;
  const from = card.getBoundingClientRect(), to = panel.getBoundingClientRect();

  overlay.classList.remove('is-open');
  document.documentElement.classList.remove('is-locked');
  openIndex = -1;

  const anim = panel.animate([{ clipPath: FULL }, { clipPath: insetFrom(from, to) }],
    { duration: reduce ? 0 : 420, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
  anim.onfinish = () => {
    if (openIndex < 0) overlay.innerHTML = '';   // don't wipe a panel that was re-opened meanwhile
    card.focus({ preventScroll: true });
  };
}


// ---- section background image ------------------------------------------------
function setShowcaseBg(section) {
  const src = (section.dataset.bg || '').trim();
  const bg = section.querySelector('.showcase__bg');
  if (!src || !bg) return;
  if (!/^(https?:\/\/|assets\/|\.?\/)/i.test(src)) return;   // local file or https only
  const img = new Image();
  img.onload = () => {
    bg.style.setProperty('--showcase-bg', `url(${JSON.stringify(src)})`);
    section.classList.add('has-bg');   // fades the image in once it has loaded
  };
  img.src = src;
}



// ---- init ---------------------------------------------------------------------
export async function initHomePlans() {
  const section = document.getElementById('plans-showcase');
  if (!section) return;

  let list = [];
  try { list = await api.get('/plans/templates'); } catch { return; }   // keep the classic CTA band
  templates = (Array.isArray(list) ? list : []).slice(0, 6);
  if (!templates.length) return;

  track = document.getElementById('spot-track');
  prevBtn = section.querySelector('.spot__arrow--prev');
  nextBtn = section.querySelector('.spot__arrow--next');
  track.innerHTML = templates.map(cardHtml).join('');
  items = [...track.children];

  const dotsHost = document.getElementById('spot-dots');
  dotsHost.innerHTML = templates.map((t, i) =>
    `<button class="spot__dot" type="button" data-dot="${i}" aria-label="Show ${esc(t.title)}"></button>`).join('');
  dotEls = [...dotsHost.children];

  if (templates.length < 2) { prevBtn.hidden = nextBtn.hidden = dotsHost.hidden = true; }

  document.body.insertAdjacentHTML('beforeend', '<div class="spot-overlay" id="spot-overlay"></div>');
  overlay = document.getElementById('spot-overlay');

  section.hidden = false;
  document.getElementById('cta-fallback')?.setAttribute('hidden', '');
  requestAnimationFrame(() => { measure(); centerOn(0, true); update(); });

  track.addEventListener('scroll', () => {
    if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
  }, { passive: true });

  track.addEventListener('click', (e) => {
    const li = e.target.closest('.spot__item');
    if (!li || !e.target.closest('.spot-card')) return;
    const i = Number(li.dataset.i);
    i === active ? openPanel(i) : centerOn(i);
  });
  prevBtn.addEventListener('click', () => centerOn(active - 1));
  nextBtn.addEventListener('click', () => centerOn(active + 1));
  dotsHost.addEventListener('click', (e) => { const d = e.target.closest('[data-dot]'); if (d) centerOn(Number(d.dataset.dot)); });
  document.getElementById('spot').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); centerOn(active - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); centerOn(active + 1); }
  });
    addEventListener('resize', () => { measure(); centerOn(active, true); update(); }, { passive: true });

  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) closePanel(); });
  document.addEventListener('keydown', (e) => {
    if (openIndex < 0) return;
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...overlay.querySelectorAll('button, a[href]')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  
  // Background image for this section. Set it in index.html: <section id="plans-showcase" data-bg="assets/media/plans-bg.jpg">
  setShowcaseBg(section);
}