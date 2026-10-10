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
 * Smoothness notes (why slow swipes used to look "rough"):
 *   1. playbackRate was rewritten on every frame; browsers re-sync the media clock each time.
 *      It is now quantised and only written when it really changes.
 *   2. Very low rates on a 30fps clip show each source frame for ~100ms = stutter. The clips are
 *      now 60fps (motion-interpolated) and the slowest playing speed is MIN_RATE.
 *   3. play()/pause() flapped near zero speed. Start/stop now use two different thresholds.
 *   4. Start-up delay: play() used to be called only after the scroll had begun, then the speed ramped
 *      up slowly from zero. Now the video wakes on the very first touchmove / wheel / scroll event
 *      and starts already at MIN_RATE.
 *
 * Tune the feel with the constants below.
 */
import { initSiteGL } from './site-gl.js';

const PX_PER_SECOND_FOR_1X = 900;   // scroll speed (px/s) that plays the video at normal speed
const MIN_RATE = 0.6;               // slowest playback while you're moving (60fps clip => >=36 visible fps)
const MAX_RATE = 3;                 // fastest playback on a hard flick
const HOLD_MS = 220;                // keep full speed this long after the last movement...
const FADE_TAU_MS = 170;            // ...then ease out (total tail ≈ 0.5s)
const START_RATE = 0.3;             // start playing above this smoothed rate
const STOP_RATE = 0.2;              // pause only when it eases below this (gap = no start/stop flapping)
const RATE_STEP = 0.05;             // playbackRate is rounded to this and only written when it changes by a step

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

  // Stars layer (three.js) on every page; loaded when the browser is idle so it never delays first paint.
  if ('requestIdleCallback' in window) requestIdleCallback(() => initSiteGL(), { timeout: 3000 });
  else setTimeout(() => initSiteGL(), 1500);

  // Reduced motion: just the still frame, and don't download the video at all.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.src = small ? 'assets/media/glass-flower-mobile-60.mp4' : 'assets/media/glass-flower-60.mp4';
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

  // Wake the video the instant the user starts moving (before the scroll even registers),
  // already at a visible speed, so there is no "dead" moment at the start of a swipe.
  function wake() {
    lastInputAt = performance.now();
    if (playing) return;
    drive = Math.max(drive, MIN_RATE);
    rate = Math.max(rate, MIN_RATE);
    setRate(rate);
    start();
  }

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const d = Math.abs(y - lastY);
    pendingPx += d;
    lastY = y;
    if (d > 0) wake();
  }, { passive: true });

  window.addEventListener('wheel', (e) => {
    wake();
    if (!canScroll()) pendingPx += Math.abs(e.deltaY);   // short pages: wheel still moves the flower
  }, { passive: true });
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    wake();                                               // fires before the page scroll event
    if (touchY !== null && !canScroll()) pendingPx += Math.abs(touchY - y);
    touchY = y;
  }, { passive: true });
  window.addEventListener('touchend', () => { touchY = null; }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) wake();
  }, { passive: true });

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

  let appliedRate = 1;
  function setRate(r) {
    const q = Math.min(MAX_RATE, Math.max(0.0625, Math.round(r / RATE_STEP) * RATE_STEP));
    if (Math.abs(q - appliedRate) >= RATE_STEP - 1e-6) {   // skip tiny changes: no clock re-sync every frame
      video.playbackRate = q;
      appliedRate = q;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(1, Math.min(now - lastFrameAt, 100));
    lastFrameAt = now;
    if (document.hidden) { stop(); return; }

    if (pendingPx > 0) {
      const pxPerSec = (pendingPx / dt) * 1000;
      const target = Math.min(MAX_RATE, Math.max(MIN_RATE, pxPerSec / PX_PER_SECOND_FOR_1X));
      drive += (target - drive) * (target > drive ? 0.45 : 0.15);   // quick to speed up, gentle to slow down
      lastInputAt = now;
      pendingPx = 0;
    } else if (now - lastInputAt > HOLD_MS) {
      drive *= Math.exp(-dt / FADE_TAU_MS);      // ease out after you stop
    }

    rate += (drive - rate) * (1 - Math.exp(-dt / (drive > rate ? 25 : 70)));   // fast attack, soft release

    if (rate > START_RATE || (playing && rate > STOP_RATE)) {
      start();
      setRate(rate);
    } else {
      drive = 0;
      stop();
    }
  }
  requestAnimationFrame(frame);
}