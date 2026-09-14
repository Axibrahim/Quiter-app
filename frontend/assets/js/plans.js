/**
 * Quiter — plans.js
 *
 * Handles:
 * - Auth state & navbar rendering
 * - Bloom backdrop scroll blur effect
 * - Lenis smooth scroll
 * - Catalog loading (GET /api/v1/plans/templates)
 * - Category filter pills
 * - Plan adoption (POST /api/v1/plans/adopt)
 * - Auth modal for logged-out visitors
 * - GSAP scroll & hover interactions
 */

import { initAuthState, getCurrentUser } from './modules/auth-state.js';
import { api } from './modules/api-client.js';

const FALLBACK_TEMPLATES = [
  {
    id: 'smoke-free',
    slug: 'smoke-free',
    title: 'Becoming Smoke-Free',
    identity_statement: 'I am someone whose lungs are their own again.',
    direction: 'break',
    category: 'smoking',
    length_days: 30,
    active_count: '4,812 active',
    glyph: '🚬',
    glow: 'rgba(255,107,74,0.35)'
  },
  {
    id: 'sober',
    slug: 'sober',
    title: 'Becoming Sober',
    identity_statement: "I am someone who doesn't need it to feel okay.",
    direction: 'break',
    category: 'alcohol',
    length_days: 30,
    active_count: '3,190 active',
    glyph: '🍷',
    glow: 'rgba(255,107,74,0.35)'
  },
  {
    id: 'athlete',
    slug: 'athlete',
    title: 'Becoming an Athlete',
    identity_statement: 'I am someone who moves every day, no matter what.',
    direction: 'build',
    category: 'fitness',
    length_days: 15,
    active_count: '6,004 active',
    glyph: '🏃',
    glow: 'rgba(63,232,201,0.35)'
  }
];

let allTemplates = [];
let activeFilter = 'all';

function getCategoryGlyph(category, direction) {
  if (category === 'smoking') return '🚬';
  if (category === 'alcohol') return '🍷';
  if (category === 'fitness') return '🏃';
  if (category === 'mindfulness') return '🧘';
  if (category === 'sleep') return '🌙';
  return direction === 'break' ? '🔥' : '🌱';
}

function getCategoryGlow(direction) {
  return direction === 'break' ? 'rgba(255,107,74,0.35)' : 'rgba(63,232,201,0.35)';
}

function getPlanPhoto(template) {
  return `assets/media/plans/${template.slug || template.id}.jpg`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderPlanCard(template) {
  const glyph = template.glyph || getCategoryGlyph(template.category, template.direction);
  const glow = template.glow || getCategoryGlow(template.direction);
  const directionText = template.direction === 'break' ? 'Break' : 'Build';
  const categoryText = template.category ? `${directionText} · ${template.category.charAt(0).toUpperCase() + template.category.slice(1)}` : directionText;

  const card = document.createElement('div');
  card.className = 'liquid-glass liquid-glass--panel plan-card';
  card.dataset.slug = template.slug || '';
  card.dataset.id = template.id || '';
  card.dataset.direction = template.direction;
  card.dataset.length = template.length_days;

  card.innerHTML = `
    <div class="plan-card__photo" style="--plan-glow: ${glow};" aria-hidden="true">${glyph}</div>
    <div class="plan-card__body">
      <span class="plan-card__direction plan-card__direction--${template.direction}">${escapeHtml(categoryText)}</span>
      <h3 class="plan-card__title">${escapeHtml(template.title)}</h3>
      <p class="plan-card__identity">"${escapeHtml(template.identity_statement)}"</p>
      <div class="plan-card__meta">
        <span>${template.length_days} days</span>
        <span>${template.active_count || 'Active now'}</span>
        </div>
          <button class="liquid-glass btn btn--glass plan-card__choose" data-adopt-btn type="button">${template.enrolled ? 'Continue plan' : 'Choose this plan'}</button>
        </div>
  `;

  card.querySelector('[data-adopt-btn]')?.addEventListener('click', () => handleAdopt(template));
  return card;
}


function renderHeroSlide(template) {
  const glow = template.glow || getCategoryGlow(template.direction);
  const ctaText = template.enrolled ? 'Continue plan' : (template.cta_text || 'Start Your Journey');
  const bodyText = template.description || template.identity_statement;

  const slide = document.createElement('div');
  slide.className = 'plans-swiper__slide';
  slide.dataset.slug = template.slug || '';

  const hasPhoto = Boolean(template.photo_url);

  slide.innerHTML = `
    <div class="plans-swiper__photo-wrap" style="--plan-glow: ${glow};">
      ${hasPhoto ? `<img class="plans-swiper__photo" src="${template.photo_url}" alt="" loading="lazy" />` : ''}
      <div class="plans-swiper__glyph" aria-hidden="true">${template.glyph || getCategoryGlyph(template.category, template.direction)}</div>
    </div>
    <div class="plans-swiper__scrim"></div>

    ${template.age_rating ? `<span class="plans-swiper__age-badge">${escapeHtml(template.age_rating)}</span>` : ''}

    <div class="plans-swiper__info">
      ${template.tagline ? `<p class="plans-swiper__tagline">${escapeHtml(template.tagline)}</p>` : ''}
      <h2 class="plans-swiper__title">${escapeHtml(template.title)}</h2>
      ${bodyText ? `<p class="plans-swiper__desc">${escapeHtml(bodyText)}</p>` : ''}
      <button class="liquid-glass btn btn--solid plans-swiper__choose" data-adopt-btn type="button">${escapeHtml(ctaText)}</button>
      ${template.is_included !== false ? `
        <span class="plans-swiper__included">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
          Included with Quiter
        </span>
      ` : ''}
    </div>
  `;

  if (!hasPhoto) {
    slide.classList.add('plans-swiper__slide--noimg');
  } else {
    slide.querySelector('.plans-swiper__photo')
      ?.addEventListener('error', () => slide.classList.add('plans-swiper__slide--noimg'), { once: true });
  }
  slide.querySelector('[data-adopt-btn]')?.addEventListener('click', () => handleAdopt(template));
  return slide;
}

function renderHeroSwiper() {
  const track = document.getElementById('plans-swiper-track');
  const dotsWrap = document.getElementById('plans-swiper-dots');
  if (!track) return;

  track.innerHTML = '';
  if (dotsWrap) dotsWrap.innerHTML = '';

  if (allTemplates.length === 0) {
    track.innerHTML = '<p style="color: var(--ink-40); padding: 2rem;">No plans available yet.</p>';
    return;
  }

  allTemplates.forEach((t, i) => {
    track.appendChild(renderHeroSlide(t));
    if (dotsWrap) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'plans-swiper__dot' + (i === 0 ? ' is-active' : '');
      dot.setAttribute('aria-label', `Go to ${t.title}`);
      dot.addEventListener('click', () => {
        track.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      });
      dotsWrap.appendChild(dot);
    }
  });

  initSwiperInteractions();
}

function initSwiperInteractions() {
  const track = document.getElementById('plans-swiper-track');
  const prevBtn = document.getElementById('swiper-prev');
  const nextBtn = document.getElementById('swiper-next');
  if (!track) return;

  const scrollByOne = (dir) => {
    const slide = track.querySelector('.plans-swiper__slide');
    if (!slide) return;
    const amount = slide.getBoundingClientRect().width + 16;
    track.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  prevBtn?.addEventListener('click', () => scrollByOne(-1));
  nextBtn?.addEventListener('click', () => scrollByOne(1));

  // Click-and-drag support for mouse/trackpad — touch already swipes natively
  let isDown = false;
  let startX = 0;
  let scrollStart = 0;

  track.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // let button clicks through untouched
    isDown = true;
    track.classList.add('is-dragging');
    startX = e.clientX;
    scrollStart = track.scrollLeft;
    track.setPointerCapture(e.pointerId);
  });

  track.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    track.scrollLeft = scrollStart - (e.clientX - startX);
  });

  const endDrag = () => {
    isDown = false;
    track.classList.remove('is-dragging');
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointerleave', endDrag);

    // Keep the active dot AND the focused slide in sync while swiping
  const dots = document.querySelectorAll('.plans-swiper__dot');
  const slides = [...track.querySelectorAll('.plans-swiper__slide')];
  if (slides.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-active', entry.isIntersecting && entry.intersectionRatio > 0.6);
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          const idx = slides.indexOf(entry.target);
          dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
        }
      });
    }, { root: track, threshold: [0, 0.6, 1] });
    slides.forEach((s) => observer.observe(s));
  }
}

function renderCustomPlanCard() {
  const card = document.createElement('a');
  card.href = 'custom-plan.html';
  card.className = 'liquid-glass liquid-glass--panel plan-card plan-card--custom';
  card.id = 'custom-plan-card';
  card.innerHTML = `
    <span class="plan-card__glyph" aria-hidden="true">✨</span>
    <h3 class="plan-card__title">Build your own</h3>
    <p class="plan-card__identity" style="max-width: 22ch;">Not on the list? Describe your own goal and we'll craft an identity plan around it.</p>
  `;
  return card;
}

function applyFilters() {
  const grid = document.getElementById('catalog-plan-grid');
  if (!grid) return;

  grid.innerHTML = '';

  const filtered = allTemplates.filter((t) => {
    if (activeFilter.startsWith('direction:')) {
      const dir = activeFilter.split(':')[1];
      if (t.direction !== dir) return false;
    } else if (activeFilter.startsWith('length:')) {
      const len = parseInt(activeFilter.split(':')[1], 10);
      if (t.length_days !== len) return false;
    }
    return true;
  });

  filtered.forEach((t) => grid.appendChild(renderPlanCard(t)));
  grid.appendChild(renderCustomPlanCard());
  initGlassHover();
}

async function mergeEnrollments() {
  if (!getCurrentUser()) return;

  let mine = [];
  try {
    mine = await api.get('/plans/mine');
  } catch {
    return; // not logged in / network hiccup — catalog still renders without enrollment state
  }

  const active = mine.filter((p) => !p.is_completed && !p.is_abandoned);
  const byTemplateId = new Map(active.map((p) => [p.template_id, p]));

  allTemplates = allTemplates.map((t) => {
    const mineEntry = byTemplateId.get(t.id);
    return mineEntry
      ? { ...t, enrolled: true, user_plan_id: mineEntry.user_plan_id }
      : t;
  });

  // Custom plans are marked is_active=false on the backend so they never
  // appear in the public /templates catalog — surface the user's own
  // enrolled custom plans here so they still show up in this page.
  const catalogIds = new Set(allTemplates.map((t) => t.id));
  const customPlans = active
    .filter((p) => p.category === 'custom' && !catalogIds.has(p.template_id))
    .map((p) => ({
      id: p.template_id,
      slug: p.template_id,
      title: p.title,
      identity_statement: p.identity_statement,
      direction: p.direction,
      category: p.category,
      length_days: p.total_days,
      photo_url: p.photo_url,
      description: 'Your custom plan.',
      enrolled: true,
      user_plan_id: p.user_plan_id,
    }));

  allTemplates = [...allTemplates, ...customPlans];
}

async function loadCatalog() {
  const loading = document.getElementById('plans-loading');
  if (loading) loading.style.display = '';

  try {
    const data = await api.get('/plans/templates');
    if (Array.isArray(data) && data.length > 0) {
      allTemplates = data;
    } else {
      allTemplates = FALLBACK_TEMPLATES;
    }
  } catch {
    allTemplates = FALLBACK_TEMPLATES;
  }

  await mergeEnrollments();

  const loadingEl = document.getElementById('plans-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  applyFilters();
  renderHeroSwiper();
}

async function handleAdopt(template) {
  const user = getCurrentUser();

  if (!user) {
    if (window.openAuthModal) {
      window.openAuthModal('login');
    }
    return;
  }

  if (template.enrolled) {
    window.location.href = 'dashboard.html';
    return;
  }

  try {
    await api.post('/plans/adopt', { template_id: template.id });
    window.location.href = 'dashboard.html';
  } catch (err) {
    if (err.message === 'already_enrolled') {
      window.location.href = 'dashboard.html';
    } else {
      alert(`Could not start plan: ${err.message}`);
    }
  }
}

/* =========================================================================
   AUTH MODAL FOR PLANS PAGE
   ========================================================================= */

function initAuth() {
  const overlay = document.getElementById('auth-modal-overlay');
  const closeButton = document.getElementById('auth-modal-close');
  const loginTab = document.getElementById('tab-login');
  const signupTab = document.getElementById('tab-signup');
  const form = document.getElementById('auth-form');
  const title = document.getElementById('auth-modal-title');
  const submitButton = document.getElementById('auth-submit');
  const displayNameField = document.getElementById('field-display-name');
  const displayNameInput = document.getElementById('auth-display-name');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const errorElement = document.getElementById('auth-error');

  if (!overlay || !form) return;

  let mode = 'login';

  function updateMode() {
    const isSignup = mode === 'signup';
    loginTab?.classList.toggle('is-active', !isSignup);
    signupTab?.classList.toggle('is-active', isSignup);

    if (isSignup) {
      title.textContent = 'Create your identity';
      submitButton.textContent = 'Create account';
      displayNameField.style.display = '';
      passwordInput.setAttribute('autocomplete', 'new-password');
    } else {
      title.textContent = 'Welcome back';
      submitButton.textContent = 'Login';
      displayNameField.style.display = 'none';
      passwordInput.setAttribute('autocomplete', 'current-password');
    }
    if (errorElement) errorElement.textContent = '';
  }

  function openAuth(type) {
    mode = type;
    updateMode();
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (mode === 'signup') displayNameInput?.focus();
      else emailInput?.focus();
    }, 50);
  }

  window.openAuthModal = openAuth;

  function closeAuth() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    form.reset();
    if (errorElement) errorElement.textContent = '';
  }

  function bindNavTriggers() {
    document.getElementById('signup-trigger')?.addEventListener('click', () => openAuth('signup'));
  }

  bindNavTriggers();
  document.addEventListener('quiter:nav-rendered', bindNavTriggers);

  loginTab?.addEventListener('click', () => openAuth('login'));
  signupTab?.addEventListener('click', () => openAuth('signup'));
  closeButton?.addEventListener('click', closeAuth);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAuth(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorElement) errorElement.textContent = '';
    submitButton.disabled = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const payload = { email, password };
    if (mode === 'signup') payload.display_name = displayNameInput.value.trim();

    const API_BASE = 'http://127.0.0.1:5000';
    const endpoint = mode === 'signup'
      ? `${API_BASE}/api/v1/auth/register`
      : `${API_BASE}/api/v1/auth/login`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Quiter-Client': 'web' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Authentication failed');

      closeAuth();
      await initAuthState();
    } catch (err) {
      if (errorElement) errorElement.textContent = err.message || 'Something went wrong.';
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initGlassHover() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (prefersReducedMotion || !hasFinePointer) return;

  document.querySelectorAll('.plan-card').forEach((card) => {
    let raf = null;
    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.setProperty('--glass-x', '50%');
        card.style.setProperty('--glass-y', '50%');
        card.style.setProperty('--glass-rotate-x', '0deg');
        card.style.setProperty('--glass-rotate-y', '0deg');
        card.style.setProperty('--glass-scale', '1');
        card.style.setProperty('--glass-lift', '0px');
      });
    };

    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const px = x * 2 - 1;
      const py = y * 2 - 1;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.setProperty('--glass-x', `${x * 100}%`);
        card.style.setProperty('--glass-y', `${y * 100}%`);
        card.style.setProperty('--glass-rotate-x', `${py * -2.2}deg`);
        card.style.setProperty('--glass-rotate-y', `${px * 2.2}deg`);
        card.style.setProperty('--glass-scale', '1.012');
        card.style.setProperty('--glass-lift', '-5px');
      });
    });

    card.addEventListener('pointerleave', reset);
  });
}

function initSmoothScroll() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion || typeof Lenis === 'undefined') return null;

  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => { lenis.raf(time * 1000); });
  gsap.ticker.lagSmoothing(0);
  return lenis;
}



/* =========================================================================
   BOOT
   ========================================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    initSmoothScroll();
  } catch (e) {
    console.error('[smooth scroll failed]', e);
  }

  await initAuthState();
  initAuth();
  await loadCatalog();

  // Filter button listeners
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeFilter = btn.dataset.filter || 'all';
      applyFilters();
    });
  });

  // GSAP scroll reveals
  try {
    gsap.registerPlugin(ScrollTrigger);
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        y: 24,
        opacity: 0,
        duration: 0.7,
        ease: 'power3.out',
      });
    });
  } catch (e) {
    console.error('[plans reveal animation failed]', e);
  }
});