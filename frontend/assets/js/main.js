/**
 * Quiter — main.js
 *
 * Orchestrates:
 * - Hero video looping & scroll blur
 * - Lenis smooth scroll
 * - GSAP scroll-triggered reveals
 * - Hero typewriter effect (static title + dynamic line 2)
 * - Liquid-glass hover interactions
 * - WebGL bloom reward
 * - Habit tracking API calls
 * - Plan interactions
 * - Authentication modal & nav state
 *
 * Vanilla ES modules only.
 */

import { BloomScene } from './three/bloom-scene.js';
import { api } from './modules/api-client.js';
import { initAuthState } from './modules/auth-state.js';



/* =========================================================================
   2. HERO VIDEO SCROLL BLUR
   ========================================================================= */

function initHeroVideoScrollEffect() {
  const video = document.getElementById('hero-video');
  if (!video) return;

  const hero = video.closest('.hero');
  if (!hero) return;

  let raf = null;

  const update = () => {
    raf = null;
    const rect = hero.getBoundingClientRect();
    const heroHeight = hero.offsetHeight;
    const progress = Math.min(1, Math.max(0, -rect.top / (heroHeight * 0.75)));
    const blur = progress * 18;
    video.style.setProperty('--hero-blur', `${blur}px`);
  };

  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  update();
}


/* =========================================================================
   3. LENIS SMOOTH SCROLL
   ========================================================================= */

function initSmoothScroll() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return null;

  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => { lenis.raf(time * 1000); });
  gsap.ticker.lagSmoothing(0);

  window.__lenisInstance = lenis;
  return lenis;}


/* =========================================================================
   4. GSAP SCROLL REVEALS
   ========================================================================= */

function initScrollAnimations() {
  gsap.registerPlugin(ScrollTrigger);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    gsap.set('[data-reveal]', { opacity: 1, y: 0 });
    return;
  }

  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.hero__title', { y: 20, opacity: 0, duration: 0.8, delay: 0.15 })
    .from('.hero__subtitle', { y: 16, opacity: 0, duration: 0.6 }, '-=0.4')
    .from('.hero__actions', { y: 16, opacity: 0, duration: 0.6 }, '-=0.4');

  document.querySelectorAll('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      y: 28,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out'
    });
  });
}


/* =========================================================================
   5. HERO TYPEWRITER EFFECT (Main Title Remains Static)
   ========================================================================= */

function initTypewriterEffect() {
  const dynamicTextEl = document.getElementById('typewriter-text');
  const cursorEl = document.getElementById('typewriter-cursor');

  if (!dynamicTextEl) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    dynamicTextEl.innerHTML = '<em>becoming</em>.';
    if (cursorEl) cursorEl.style.display = 'none';
    return;
  }

  const phrases = [
    { text: 'becoming.', isEm: true },
    { text: 'becoming smoke-free.', isEm: false },
    { text: 'becoming sober.', isEm: false },
    { text: 'becoming an athlete.', isEm: false },
    { text: 'becoming your true self.', isEm: false },
    { text: 'becoming.', isEm: true }
  ];

  let phraseIndex = 0;
  let isDeleting = false;
  let currentChars = 'becoming.';
  let typingSpeed = 70;

  dynamicTextEl.innerHTML = '<em>becoming</em>.';

  function typeDynamicText() {
    const currentPhrase = phrases[phraseIndex];
    const fullText = currentPhrase.text;

    cursorEl?.classList.add('is-typing');

    if (isDeleting) {
      currentChars = fullText.substring(0, currentChars.length - 1);
      typingSpeed = 30 + Math.random() * 20;
    } else {
      currentChars = fullText.substring(0, currentChars.length + 1);
      const lastChar = fullText.charAt(currentChars.length - 1);
      typingSpeed = lastChar === ' ' ? 70 : (45 + Math.random() * 35);
    }

    if (currentPhrase.isEm) {
      dynamicTextEl.innerHTML = `<em>${currentChars}</em>`;
    } else {
      dynamicTextEl.textContent = currentChars;
    }

    if (!isDeleting && currentChars === fullText) {
      cursorEl?.classList.remove('is-typing');
      const holdTime = (phraseIndex === 0 || phraseIndex === phrases.length - 1) ? 2800 : 1800;
      isDeleting = true;
      setTimeout(typeDynamicText, holdTime);
      return;
    } else if (isDeleting && currentChars === '') {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      setTimeout(typeDynamicText, 250);
      return;
    }

    setTimeout(typeDynamicText, typingSpeed);
  }

  setTimeout(() => {
    isDeleting = true;
    typeDynamicText();
  }, 2200);
}


/* =========================================================================
   6. LIQUID GLASS HOVER SYSTEM
   ========================================================================= */

function initGlassHover() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (prefersReducedMotion || !hasFinePointer) return;

  const glassCards = document.querySelectorAll(`
    .plan-card, .service-card, .step-card, .bento-cell, .philosophy__visual, .plan-card--custom
  `);

  glassCards.forEach((card) => {
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

  const buttons = document.querySelectorAll(`.btn, .icon-btn`);
  buttons.forEach((button) => {
    let raf = null;
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      const moveX = Math.max(-6, Math.min(6, x * 0.18));
      const moveY = Math.max(-6, Math.min(6, y * 0.18));

      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        button.style.setProperty('--magnetic-x', `${moveX}px`);
        button.style.setProperty('--magnetic-y', `${moveY}px`);
        button.style.setProperty('--button-glow-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
        button.style.setProperty('--button-glow-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
      });
    });

    button.addEventListener('pointerleave', () => {
      if (raf) cancelAnimationFrame(raf);
      button.style.setProperty('--magnetic-x', '0px');
      button.style.setProperty('--magnetic-y', '0px');
      button.style.setProperty('--button-glow-x', '50%');
      button.style.setProperty('--button-glow-y', '50%');
    });
  });
}


/* =========================================================================
   7. WEBGL BLOOM REWARD
   ========================================================================= */

function initBloomScene() {
  const canvas = document.getElementById('bloom-canvas');
  if (!canvas) return null;

  const scene = new BloomScene(canvas);
  scene.start();
  window.addEventListener('pagehide', () => scene.destroy());
  return scene;
}


/* =========================================================================
   8. HABIT TRACKING
   ========================================================================= */

function initHabitTracking(bloomScene) {
  const streakFigure = document.getElementById('streak-figure');
  const longestFigure = document.getElementById('longest-figure');
  const activePlanId = document.body.dataset.activePlanId || null;

  async function submitCheckin(status) {
    if (!activePlanId) return;

    try {
      const result = await api.post(`/plans/${activePlanId}/checkin`, { status });
      if (streakFigure) streakFigure.textContent = result.current_streak;
      if (longestFigure) longestFigure.textContent = result.longest_streak;
      if (result.reward_tier > 0 && bloomScene) bloomScene.trigger(result.reward_tier);
    } catch (err) {
      console.error('[checkin failed]', err.message);
      announce(`Couldn't save today's check-in — ${err.message}. Try again.`);
    }
  }

  document.getElementById('checkin-complete')?.addEventListener('click', () => submitCheckin('completed'));
  document.getElementById('checkin-missed')?.addEventListener('click', () => submitCheckin('missed'));
}



/* =========================================================================
   10. LIVE ANNOUNCER
   ========================================================================= */

function announce(message) {
  let region = document.getElementById('sr-live-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'sr-live-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.style.cssText = `position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);`;
    document.body.appendChild(region);
  }
  region.textContent = message;
}


/* =========================================================================
   11. PLAN CARD FLIP & INTERACTIONS
   ========================================================================= */

function initPlanCardFlip() {
  document.querySelectorAll('.plan-card-flip').forEach((card) => {
    const toggle = () => {
      const flipped = card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', String(flipped));
    };

    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function initPlanInteractions() {
  document.querySelectorAll('.plan-card').forEach((card) => {
    const photo = card.querySelector('.plan-card__photo');
    if (!photo) return;

    card.addEventListener('pointerenter', () => {
      gsap.to(photo, { scale: 1.045, duration: 0.5, ease: 'power3.out', overwrite: true });
    });
    card.addEventListener('pointerleave', () => {
      gsap.to(photo, { scale: 1, duration: 0.5, ease: 'power3.out', overwrite: true });
    });
  });
}


/* =========================================================================
   12. NAV LINK MICRO-INTERACTION
   ========================================================================= */

function initNavInteractions() {
  document.querySelectorAll('.nav__links a').forEach((link) => {
    link.addEventListener('pointerenter', () => {
      gsap.to(link, { y: -1, duration: 0.2, ease: 'power2.out', overwrite: true });
    });
    link.addEventListener('pointerleave', () => {
      gsap.to(link, { y: 0, duration: 0.25, ease: 'power2.out', overwrite: true });
    });
  });
}


/* =========================================================================
   13. AUTHENTICATION & LIVE NAVBAR UPDATE
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
      if (mode === 'signup') {
        displayNameInput?.focus();
      } else {
        emailInput?.focus();
      }
    }, 50);
  }

  function closeAuth() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    form.reset();
    if (errorElement) errorElement.textContent = '';
  }

  function bindNavTriggers() {
    document.getElementById('login-trigger')?.addEventListener('click', () => openAuth('login'));
    document.getElementById('signup-trigger')?.addEventListener('click', () => openAuth('signup'));
  }

  bindNavTriggers();
  document.addEventListener('quiter:nav-rendered', bindNavTriggers);

  loginTab?.addEventListener('click', () => openAuth('login'));
  signupTab?.addEventListener('click', () => openAuth('signup'));
  closeButton?.addEventListener('click', closeAuth);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeAuth();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) closeAuth();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorElement) errorElement.textContent = '';
    submitButton.disabled = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const payload = { email, password };

    if (mode === 'signup') {
      payload.display_name = displayNameInput.value.trim();
    }

    const API_BASE = 'http://127.0.0.1:5000';
    const endpoint = mode === 'signup'
      ? `${API_BASE}/api/v1/auth/register`
      : `${API_BASE}/api/v1/auth/login`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Quiter-Client': 'web',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      let result = {};
      try { result = await response.json(); } catch { result = {}; }

      if (!response.ok) {
        throw new Error(getAuthErrorMessage(result));
      }

      announce(mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.');
      closeAuth();

      // Refresh auth state to immediately reveal Dashboard, Profile, and Logout in navbar
      await initAuthState();
    } catch (error) {
      console.error('[auth failed]', error);
      if (errorElement) {
        errorElement.textContent = error.message || 'Something went wrong.';
      }
    } finally {
      submitButton.disabled = false;
    }
  });
}

function getAuthErrorMessage(result) {
  switch (result?.error) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_already_registered':
      return 'An account with this email already exists.';
    case 'weak_password':
      return result.detail || 'Password must be at least 10 characters and contain a number and a letter.';
    case 'invalid_email':
      return 'Please enter a valid email address.';
    case 'invalid_display_name':
      return 'Display name must be between 2 and 40 characters.';
    case 'account_locked':
      return 'Too many failed attempts. Please try again later.';
    default:
      return 'Something went wrong. Please try again.';
  }
}


/* =========================================================================
   14. BOOT
   ========================================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  /* Authentication state */
  try {
    await initAuthState();
  } catch (e) {
    console.error('[auth state init failed]', e);
  }


  /* Smooth scrolling */
  try {
    initSmoothScroll();
  } catch (e) {
    console.error('[smooth scroll init failed]', e);
  }

  /* GSAP scroll animations */
  try {
    initScrollAnimations();
  } catch (e) {
    console.error('[scroll animations init failed]', e);
  }

  /* Hero typewriter effect */
  try {
    initTypewriterEffect();
  } catch (e) {
    console.error('[typewriter effect init failed]', e);
  }

  /* Liquid glass interactions */
  try {
    initGlassHover();
  } catch (e) {
    console.error('[glass hover init failed]', e);
  }

  /* WebGL bloom */
  let bloomScene = null;
  try {
    bloomScene = initBloomScene();
  } catch (e) {
    console.error('[bloom scene init failed]', e);
  }

  /* Habit tracking */
  try {
    initHabitTracking(bloomScene);
  } catch (e) {
    console.error('[habit tracking init failed]', e);
  }

  /* Plan card flip */
  try {
    initPlanCardFlip();
  } catch (e) {
    console.error('[plan card flip init failed]', e);
  }

  /* Plan interactions */
  try {
    initPlanInteractions();
  } catch (e) {
    console.error('[plan interactions init failed]', e);
  }

  /* Navigation */
  try {
    initNavInteractions();
  } catch (e) {
    console.error('[nav interactions init failed]', e);
  }

  /* Authentication modal */
  try {
    initAuth();
  } catch (e) {
    console.error('[auth init failed]', e);
  }
});

