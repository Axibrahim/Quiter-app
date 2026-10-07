/**
 * Background flower video that plays while you scroll / swipe.
 *
 * - Any scroll, mouse-wheel or touch swipe makes the video PLAY (native
 *   playback = buttery smooth, no per-frame seeking).
 * - The playback speed follows how fast you move: slow drag = slow petals,
 *   hard flick = fast spin.
 * - When you stop, it keeps playing for roughly half a second more, easing
 *   down to a stop instead of freezing.
 * - The clip loops seamlessly (first and last frame match).
 *
 * Tune the feel with the four constants below.
 */
const PX_PER_SECOND_FOR_1X = 900;   // scroll speed (px/s) that plays the video at normal speed
const MIN_RATE = 0.35;              // slowest playback while you're moving
const MAX_RATE = 3;                 // fastest playback on a hard flick
const HOLD_MS = 180;                // keep full speed this long after the last movement...
const FADE_TAU_MS = 170;            // ...then ease out (total tail ≈ 0.5s)

export function initBackground() {
  if (document.querySelector('.bg-video')) return;

  const wrap = document.createElement('div');
  wrap.className = 'bg-video';
  wrap.setAttribute('aria-hidden', 'true');
  const small = window.matchMedia('(max-width: 860px)').matches;
  // The still frame that shows until the video is ready (phones use the cropped clip's frame).
  wrap.style.backgroundImage = `url('assets/media/${small ? 'glass-flower-mobile-poster.jpg' : 'glass-flower-poster.jpg'}')`;

  const scrim = document.createElement('div');
  scrim.className = 'bg-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  document.body.prepend(scrim);
  document.body.prepend(wrap);

  // Reduced motion: just the still frame, and don't download the video at all.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.src = small ? 'assets/media/glass-flower-mobile.mp4' : 'assets/media/glass-flower.mp4';
  // Once the first frame is decoded, the black page takes over from the poster
  // (otherwise the poster would peek out around the edges when the clip is shifted/scaled).
  video.addEventListener('loadeddata', () => wrap.classList.add('is-ready'));   // CSS then hides the poster
  wrap.appendChild(video);

  let pendingPx = 0;       // distance moved since the last frame
  let lastY = window.scrollY;
  let touchY = null;
  let drive = 0;           // target playback rate from input
  let rate = 0;            // smoothed rate actually applied
  let lastInputAt = 0;
  let lastFrameAt = performance.now();
  let playing = false;

  const canScroll = () => document.documentElement.scrollHeight > window.innerHeight + 4;

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    pendingPx += Math.abs(y - lastY);
    lastY = y;
  }, { passive: true });

  // Pages too short to scroll: wheel + swipe still move the flower.
  window.addEventListener('wheel', (e) => { if (!canScroll()) pendingPx += Math.abs(e.deltaY); }, { passive: true });
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    if (touchY !== null && !canScroll()) pendingPx += Math.abs(touchY - y);
    touchY = y;
  }, { passive: true });
  window.addEventListener('touchend', () => { touchY = null; }, { passive: true });

  function start() {
    if (playing) return;
    playing = true;
    video.play().catch(() => { playing = false; });
  }
  function stop() {
    if (!playing) return;
    playing = false;
    video.pause();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(1, Math.min(now - lastFrameAt, 100));
    lastFrameAt = now;
    if (document.hidden) { stop(); return; }

    if (pendingPx > 0) {
      const pxPerSec = (pendingPx / dt) * 1000;
      const target = Math.min(MAX_RATE, Math.max(MIN_RATE, pxPerSec / PX_PER_SECOND_FOR_1X));
      drive += (target - drive) * 0.35;          // follow the swipe speed
      lastInputAt = now;
      pendingPx = 0;
    } else if (now - lastInputAt > HOLD_MS) {
      drive *= Math.exp(-dt / FADE_TAU_MS);      // ease out after you stop
    }

    rate += (drive - rate) * (1 - Math.exp(-dt / 70));   // smooth start/stop of the rate itself

    if (rate > 0.06) {
      start();
      video.playbackRate = Math.min(MAX_RATE, Math.max(0.0625, rate));
    } else {
      drive = 0;
      stop();
    }
  }
  requestAnimationFrame(frame);
}