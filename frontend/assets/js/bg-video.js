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
 * Crash-proofing:
 *   - The clip is attached only once the page has settled, so quick redirects never start a decode.
 *   - The hardware decoder is released on pagehide (every navigation).
 *   - If the page survives a pagehide (the clip was released), the next swipe or pageshow reattaches it.
 *   - Back-button / tab restore and theme switches reload the clip from the last good frame.
 *   - Errors retry up to 3 times; the poster image stays visible meanwhile.
 *
 * Tune the feel with the constants below.
 */
import { initSiteGL } from './site-gl.js';

const PX_PER_SECOND_FOR_1X = 900;   // scroll speed (px/s) that plays the video at normal speed
const MIN_RATE = 0.6;               // slowest playback while you're moving (60fps clip => >=36 visible fps)
const MAX_RATE = window.matchMedia('(max-width: 860px)').matches ? 1.35 : 3;   // phones: keep decoding well inside what a phone can do
const VEL_WINDOW_MS = 140;          // swipe speed is averaged over this window (steady even with uneven scroll events)
const HOLD_MS = 160;                // keep speed this long after the last movement...
const FADE_TAU_MS = 170;            // ...then ease out
const START_RATE = 0.3;             // start playing above this smoothed rate
const STOP_RATE = 0.2;              // pause only when it eases below this (gap = no start/stop flapping)
const PHONE = window.matchMedia('(max-width: 860px)').matches;
const RATE_STEP = PHONE ? 0.1 : 0.04;        // coarser steps on phones = fewer media-clock re-syncs while swiping
const WRITE_EVERY_MS = PHONE ? 140 : 50;     // every write re-syncs the media clock

export function initBackground() {
  function initVeil() {
    if (!document.querySelector('.hero')) return;
    const root = document.documentElement;
    const STEPS = 48;
    let target = 0, cur = 0, last = -1, raf = 0;

    const step = () => {
      raf = 0;
      cur += (target - cur) * 0.1;                       // glide toward the target
      if (Math.abs(target - cur) < 0.003) cur = target;
      const q = Math.round(cur * STEPS) / STEPS;
      if (q !== last) {
        last = q;
        veil.style.setProperty('--veil', q.toFixed(3));
        root.classList.toggle('has-veil', q > 0);
      }
      if (cur !== target) raf = requestAnimationFrame(step);
    };

    const measure = () => {
      const vh = window.innerHeight || 1;
      const t = Math.min(1, Math.max(0, (window.scrollY - vh * 0.25) / (vh * 1.1)));
      target = t * t * (3 - 2 * t);
      if (!raf) raf = requestAnimationFrame(step);
    };

    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    measure();
  }

  if (document.querySelector('.bg-video')) return;

  const wrap = document.createElement('div');
  wrap.className = 'bg-video';
  wrap.setAttribute('aria-hidden', 'true');
  const small = window.matchMedia('(max-width: 860px)').matches;
  // The still frame that shows until the video is ready (phones use the cropped clip's frame).
  const posterUrl = `url('assets/media/${small ? 'glass-flower-mobile-poster.jpg' : 'glass-flower-poster.jpg'}')`;
  wrap.style.backgroundImage = posterUrl;
  // url() inside a CSS variable resolves against the STYLESHEET, so give it an absolute address
  wrap.style.setProperty('--poster', `url('${new URL(`assets/media/${small ? 'glass-flower-mobile-poster.jpg' : 'glass-flower-poster.jpg'}`, document.baseURI).href}')`);   // light theme paints it (inverted) on ::before

  const scrim = document.createElement('div');
  scrim.className = 'bg-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  const veil = document.createElement('div');
  veil.className = 'bg-veil';
  veil.setAttribute('aria-hidden', 'true');
  document.body.prepend(veil);
  document.body.prepend(scrim);
  document.body.prepend(wrap);
  initVeil();
  
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
  const isLightTheme = () => document.documentElement.dataset.theme === 'light';
  const videoSrc = () => `assets/media/glass-flower-${small ? 'mobile-' : ''}60${isLightTheme() ? '-light' : ''}.mp4`;
  // Attach the clip only once the page has settled (or on first touch), so a quick redirect never starts a decode
  let attached = false;
  function attach() {
    if (attached || document.hidden) return;
    attached = true;
    video.src = videoSrc();
  }
  attach();
  
  // Prime the decoder: iOS ignores preload="auto", so the clip would only start loading at the first swipe (= the delay).
  // Play it muted at a crawl for a moment so the first seconds are buffered and decoded, then pause. A swipe then starts instantly.
  let primed = false;
  function prime() {
    if (primed || !video.getAttribute('src')) return;
    primed = true;
    video.playbackRate = 0.0625;
    appliedRate = 0.0625;
    const p = video.play();
    if (p && p.then) {
      p.then(() => setTimeout(() => { if (!playing) video.pause(); }, 400)).catch(() => { primed = false; });
    }
  }
  video.addEventListener('loadedmetadata', prime);

  ['touchstart', 'wheel', 'scroll', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { attach(); prime(); }, { once: true, passive: true }));




  // errors: missing -light clip -> dark clip + CSS filter; anything else -> retry a few times (poster stays visible meanwhile)
  let retries = 0;
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;                 // we released it ourselves
    wrap.classList.remove('is-ready');
    if (isLightTheme() && video.src.includes('-light')) { wrap.classList.add('needs-filter'); video.src = videoSrc().replace('-light', ''); return; }
    if (retries++ < 3) setTimeout(() => loadClip(clipTime), 600 * retries);
  });
  // clip swap (theme switch / recovery): guarded so rapid toggles and mid-load states can't break it
  let clipTime = 0, swapToken = 0;
  video.addEventListener('timeupdate', () => { if (video.readyState >= 2 && !video.seeking) clipTime = video.currentTime; });
  function loadClip(resumeAt) {
    const token = ++swapToken;
    attached = true;
    primed = true;                                       // theme switch / recovery: the user is already interacting, no priming
    wrap.classList.remove('needs-filter', 'is-ready');   // poster shows while the new clip loads, no black gap
    video.pause();
    video.src = videoSrc();
    video.load();
    appliedRate = 1;
    video.addEventListener('loadedmetadata', () => {
      if (token !== swapToken) return;                   // a newer swap superseded this one
      try { if (video.duration) video.currentTime = resumeAt % video.duration; } catch (e) {}
      video.playbackRate = 1;
      if (playing) video.play().catch(() => {});
    }, { once: true });
  }
  addEventListener('quiter:theme', () => loadClip(clipTime));
  // Once the first frame is decoded, the black page takes over from the poster
  // (otherwise the poster would peek out around the edges when the clip is shifted/scaled).
  video.addEventListener('loadeddata', () => wrap.classList.add('is-ready'));   // CSS then hides the poster
  wrap.appendChild(video);

  const samples = [];      // recent movements: { t: time, px: distance }
  let lastY = window.scrollY;
  let touchY = null;
  let drive = 0;           // target playback rate from the measured swipe speed
  let mid = 0;             // smoothing stage 1
  let rate = 0;            // smoothing stage 2 = the rate the video really plays at
  let lastInputAt = 0;
  let lastFrameAt = performance.now();
  let lastWriteAt = 0;
  let appliedRate = 1;
  let playing = false;

  const canScroll = () => document.documentElement.scrollHeight > window.innerHeight + 4;

  function addMove(px) {
    if (!(px > 0)) return;
    const now = performance.now();
    samples.push({ t: now, px });
    lastInputAt = now;
  }

  // Wake the video the instant the user starts moving (before the scroll even registers),
  // already at a visible speed, so there is no "dead" moment at the start of a swipe.
  function wake() {
    lastInputAt = performance.now();
    if (playing) return;
    drive = Math.max(drive, MIN_RATE);
    mid = Math.max(mid, MIN_RATE);
    rate = Math.max(rate, MIN_RATE);
    setRate(rate, lastInputAt, true);
    start();
  }

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const d = Math.abs(y - lastY);
    lastY = y;
    if (d > 0) { addMove(d); wake(); }
  }, { passive: true });

  window.addEventListener('wheel', (e) => {
    wake();
    if (!canScroll()) addMove(Math.abs(e.deltaY));   // short pages: wheel still moves the flower
  }, { passive: true });
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    wake();                                           // fires before the page scroll event
    if (touchY !== null && !canScroll()) addMove(Math.abs(touchY - y));
    touchY = y;
  }, { passive: true });
  window.addEventListener('touchend', () => { touchY = null; }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) wake();
  }, { passive: true });

  let lastPlayTry = 0;
  function start() {
    if (playing) return;
    const now = performance.now();
    if (now - lastPlayTry < 200) return;       // a refused play() must not be retried every frame
    lastPlayTry = now;
    if (!video.getAttribute('src')) loadClip(clipTime);   // clip was released (pagehide) but the page stayed alive: reattach
    playing = true;
    const p = video.play();
    if (p && p.catch) p.catch(() => { playing = false; });
  }
  function stop() {
    if (!playing) return;
    playing = false;
    video.pause();
  }

  // Watchdog: if the browser silently pauses or stalls the video during a hard flick, kick it again.
  let wdAt = 0, wdTime = -1, wdStuck = 0;
  function watchdog(now) {
    if (now - wdAt < 400) return;
    wdAt = now;
    if (!playing || document.hidden) { wdStuck = 0; wdTime = -1; return; }
    if (video.paused) { video.play().catch(() => {}); return; }
    if (video.currentTime === wdTime) {                        // not advancing = frozen frame
      wdStuck++;
      if (wdStuck === 1) video.play().catch(() => {});
      else { try { video.currentTime = video.currentTime + 0.04; } catch (e) {} }   // nudge past the bad frame
    } else wdStuck = 0;
    wdTime = video.currentTime;
  }

  function setRate(r, now, force) {
    const q = Math.min(MAX_RATE, Math.max(0.0625, Math.round(r / RATE_STEP) * RATE_STEP));
    if (q === appliedRate) return;
    if (!force && now - lastWriteAt < WRITE_EVERY_MS) return;   // no clock re-sync every frame
    video.playbackRate = q;
    appliedRate = q;
    lastWriteAt = now;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(1, Math.min(now - lastFrameAt, 100));
    lastFrameAt = now;
    if (document.hidden) { stop(); return; }
    watchdog(now);

    // swipe speed = distance moved over the last VEL_WINDOW_MS (steady, not per-frame noise)
    while (samples.length && now - samples[0].t > VEL_WINDOW_MS) samples.shift();
    if (samples.length) {
      let px = 0;
      for (let i = 0; i < samples.length; i++) px += samples[i].px;
      const span = Math.min(VEL_WINDOW_MS, Math.max(60, now - samples[0].t));
      drive = Math.min(MAX_RATE, Math.max(MIN_RATE, (px / span * 1000) / PX_PER_SECOND_FOR_1X));
    } else if (now - lastInputAt > HOLD_MS) {
      drive *= Math.exp(-dt / FADE_TAU_MS);          // ease out after you stop
    }

    // two smoothing stages: speed never changes abruptly, whatever the swipe does
    mid  += (drive - mid)  * (1 - Math.exp(-dt / (drive > mid ? 40 : 110)));
    // the real playback rate can only change this fast (per second): a hard flick ramps up instead of jolting the decoder
    const dRate = (mid - rate) * (1 - Math.exp(-dt / 50));
    const lim = (small ? 1.8 : 5) * dt / 1000;
    rate += Math.max(-lim, Math.min(lim, dRate));

    if (rate > START_RATE || (playing && rate > STOP_RATE)) {
      start();
      setRate(rate, now);
    } else {
      drive = 0; mid = 0; rate = 0;
      stop();
    }
  }

  // Leaving the page (link, redirect, Back): free the hardware decoder immediately
  function release() {
    swapToken++;
    stop();
    try { video.removeAttribute('src'); video.load(); } catch (e) {}
    wrap.classList.remove('is-ready');
    attached = false;
  }
  // Back button / tab restore: the decoder may be gone, so reload from the last good frame
  function recover() {
    stop();
    drive = 0; mid = 0; rate = 0; samples.length = 0;
    wdTime = -1; wdStuck = 0; retries = 0;
    loadClip(clipTime);
  }
  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', (e) => { if (e.persisted || !video.getAttribute('src')) recover(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && attached && (video.error || video.readyState < 2)) recover();
  });
  requestAnimationFrame(frame);
}
