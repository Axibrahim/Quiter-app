/**
 * Scroll-driven background flower video.
 * Scrubbing eases with input and coasts for 500 ms after the last gesture.
 */
const SECONDS_PER_1000PX = 1.6;
const EASE = 0.12;
const SWIPE_TAIL_MS = 500;

export function initBackground() {
  if (document.querySelector('.bg-video')) return;

  const small = window.matchMedia('(max-width: 760px)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const wrap = document.createElement('div');
  wrap.className = 'bg-video';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.backgroundImage = "url('assets/media/glass-flower-poster.jpg')";

  let video = null;
  if (!reducedMotion) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = small ? 'metadata' : 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.src = small ? 'assets/media/glass-flower-mobile.mp4' : 'assets/media/glass-flower.mp4';
    video.addEventListener('canplay', () => wrap.classList.add('is-ready'), { once: true });
    wrap.appendChild(video);
  }

  const scrim = document.createElement('div');
  scrim.className = 'bg-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  document.body.prepend(scrim);
  document.body.prepend(wrap);

  if (reducedMotion || !video) return;

  let duration = 0;
  let travel = 0;
  let shown = 0;
  let lastY = window.scrollY;
  let lastSet = -1;
  let coastStarted = 0;
  let coastVelocity = 0;
  let lastInputAt = 0;
  let frameId = 0;

  const canScroll = () => document.documentElement.scrollHeight > window.innerHeight + 4;

  function scheduleFrame() {
    if (!frameId && !document.hidden) frameId = requestAnimationFrame(frame);
  }

  function coastOffset(now) {
    if (!coastStarted) return 0;
    const elapsed = Math.max(0, Math.min(SWIPE_TAIL_MS, now - coastStarted));
    return coastVelocity * 0.18 * (1 - Math.exp(-elapsed / 150));
  }

  function addTravel(delta) {
    if (!delta) return;

    const now = performance.now();
    if (coastStarted) travel += coastOffset(now);

    const elapsed = lastInputAt ? Math.max(16, now - lastInputAt) : 32;
    coastVelocity = Math.max(-180, Math.min(180, (delta / elapsed) * 1000));
    coastStarted = now;
    lastInputAt = now;
    travel += delta;
    scheduleFrame();
  }

  function targetTravel(now) {
    if (!coastStarted) return travel;

    if (now - coastStarted >= SWIPE_TAIL_MS) {
      travel += coastOffset(now);
      coastStarted = 0;
      return travel;
    }

    return travel + coastOffset(now);
  }

  video.addEventListener('loadedmetadata', () => {
    duration = video.duration || 0;
    if (duration > 0) {
      video.play().then(() => video.pause()).catch(() => {});
      scheduleFrame();
    }
  }, { once: true });

  video.addEventListener('seeked', scheduleFrame);
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    addTravel(y - lastY);
    lastY = y;
  }, { passive: true });

  window.addEventListener('wheel', (event) => {
    if (!canScroll()) addTravel(event.deltaY);
  }, { passive: true });

  let touchY = null;
  window.addEventListener('touchstart', (event) => {
    touchY = event.touches[0]?.clientY ?? null;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (touchY === null) return;
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    if (!canScroll()) addTravel(touchY - y);
    touchY = y;
  }, { passive: true });

  window.addEventListener('touchend', () => { touchY = null; }, { passive: true });
  window.addEventListener('touchcancel', () => { touchY = null; }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    } else {
      scheduleFrame();
    }
  });

  window.addEventListener('pagehide', () => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    video.pause();
  });

  function frame() {
    frameId = 0;
    if (document.hidden || !duration) return;

    const now = performance.now();
    const target = targetTravel(now);
    shown += (target - shown) * EASE;

    if (!video.seeking) {
      const seconds = (shown / 1000) * SECONDS_PER_1000PX;
      const cycle = duration * 2;
      const p = ((seconds % cycle) + cycle) % cycle;
      const time = Math.min(duration - 0.05, p <= duration ? p : cycle - p);

      if (Math.abs(time - lastSet) > 0.012) {
        video.currentTime = time;
        lastSet = time;
      }
    }

    if (coastStarted || Math.abs(target - shown) > 0.05) scheduleFrame();
  }
}