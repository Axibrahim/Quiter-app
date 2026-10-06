/**
 * Background flower video, driven by your scrolling / swiping.
 *
 * The video never "plays" on its own. Every pixel you scroll (or wheel/swipe on
 * a page too short to scroll) moves the playhead, so the glass flower turns as
 * you move. It ping-pongs (forward, then backward) so it never jumps at the end
 * of the clip, and it eases toward its target so it feels fluid, not steppy.
 *
 * Smoothness depends on the file being all-keyframe (see CHANGES.md ffmpeg line).
 */
const SECONDS_PER_1000PX = 1.6;   // flower speed: bigger = faster turning
const EASE = 0.12;                // 0..1, how quickly the playhead catches up

export function initBackground() {
  if (document.querySelector('.bg-video')) return;

  const small = window.matchMedia('(max-width: 760px)').matches;
  const wrap = document.createElement('div');
  wrap.className = 'bg-video';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.backgroundImage = "url('assets/media/glass-flower-poster.jpg')";

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.src = small ? 'assets/media/glass-flower-mobile.mp4' : 'assets/media/glass-flower.mp4';
  wrap.appendChild(video);

  const scrim = document.createElement('div');
  scrim.className = 'bg-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  document.body.prepend(scrim);
  document.body.prepend(wrap);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // poster only

  let duration = 0;
  let travel = 0;          // total signed distance scrolled, in px
  let shown = 0;           // eased value actually applied
  let lastY = window.scrollY;
  let lastSet = -1;
  let ready = false;

  const canScroll = () => document.documentElement.scrollHeight > window.innerHeight + 4;

  video.addEventListener('loadedmetadata', () => {
    duration = video.duration || 0;
    ready = duration > 0;
    // iOS/Safari only decode paused videos reliably after one play() "unlock".
    video.play().then(() => video.pause()).catch(() => {});
  });

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    travel += y - lastY;
    lastY = y;
  }, { passive: true });

  // Pages too short to scroll: let wheel + touch swipes drive the flower instead.
  window.addEventListener('wheel', (e) => { if (!canScroll()) travel += e.deltaY; }, { passive: true });
  let touchY = null;
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (touchY === null) return;
    const y = e.touches[0].clientY;
    if (!canScroll()) travel += touchY - y;
    touchY = y;
  }, { passive: true });

  function frame() {
    requestAnimationFrame(frame);
    if (!ready || document.hidden) return;

    shown += (travel - shown) * EASE;
    const seconds = (shown / 1000) * SECONDS_PER_1000PX;
    const cycle = duration * 2;
    const p = ((seconds % cycle) + cycle) % cycle;           // 0..2d
    const t = Math.min(duration - 0.05, p <= duration ? p : cycle - p);   // ping-pong

    if (!video.seeking && Math.abs(t - lastSet) > 0.012) {
      video.currentTime = t;
      lastSet = t;
    }
  }
  requestAnimationFrame(frame);
}