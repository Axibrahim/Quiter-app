/* Runs in <head> before first paint so there's no dark->light flash. Keep it classic (not a module).
   Part 1: apply the saved theme.  Part 2: the loading screen (splash) shown until the page is ready. */
(function () {
  var t = null;
  try { t = localStorage.getItem('quiter-theme'); } catch (e) { /* private mode */ }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  var d = document.documentElement;
  d.setAttribute('data-theme', t);
  d.style.colorScheme = t;
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'light' ? '#e9ecf6' : '#000000');
})();

/* ------------------------------------------------------------------ loading screen
   Covers the page from the very first paint and lifts when ALL of these are true:
     - the page finished loading and the fonts are in
     - the navigation bar has been drawn (pages that call initShell)
     - photos in/near the first screen are loaded (<img> and inline background-image, e.g. the flower poster)
     - nothing new has been added to the page for QUIET_MS (so API-loaded cards and photos get a moment)
   It never shows for less than MIN_MS, and never for more than MAX_MS (a slow network can't trap anyone).
   Tune the feel with the numbers below.

   The screen is the Quiter logo mark: a ring, then rays growing out of it clockwise from the top,
   the long stem last, then a soft shimmer travelling round the rays until the page is ready.

   First visit on the home page: when the splash lifts, the html element gets .intro-play and the CSS
   (layout.css, "First-visit intro") runs stars -> hero text -> flower reveal. */
(function () {
  var root = document.documentElement;
  var firstVisit = true;
  try {
    firstVisit = !sessionStorage.getItem('quiter-splash');
    sessionStorage.setItem('quiter-splash', '1');
  } catch (e) { /* private mode */ }

  var MIN_MS = firstVisit ? 1500 : 700;  // shortest time the loading screen stays (long enough for the logo to draw)
  var MAX_MS = 4500;                     // longest time, whatever is still loading
  var QUIET_MS = 250;                    // how long the page must stay "still" before we reveal it
  var FADE_MS = 700;                     // how long the splash takes to dissolve
  var t0 = Date.now();

  // intro sequence: home page only, first visit of the session, not for reduced-motion users
  var intro = firstVisit && /(^|\/)(index\.html)?$/.test(location.pathname) &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- look: the logo mark, on the theme's own colours ---- */
  var fade = (FADE_MS / 1000) + 's';
  var css = [
    'html.is-loading{overflow:hidden}',
    '#splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;overflow:hidden;',
      'background:radial-gradient(50% 36% at 50% 48%,rgb(141 124 255/.14),transparent 70%),var(--bg,#000);',
      'opacity:1;filter:blur(0);transform:none;',
      'transition:opacity ' + fade + ' ease,filter ' + fade + ' ease,transform ' + fade + ' ease,visibility 0s linear ' + fade + ';',
      'animation:splash-failsafe .01s linear ' + ((MAX_MS + 1500) / 1000) + 's forwards}',
    'html[data-theme=light] #splash{background:radial-gradient(50% 36% at 50% 48%,rgb(141 124 255/.16),transparent 70%),var(--bg,#e9ecf6)}',
    'html:not(.is-loading) #splash{opacity:0;visibility:hidden;pointer-events:none;filter:blur(10px);transform:scale(1.03)}',

    /* gradient: white at the top -> lavender -> violet at the bottom (deeper indigo on the light theme) */
    '.splash__s0{stop-color:#fff}.splash__s1{stop-color:#d9d2ff}.splash__s2{stop-color:#8d7cff}',
    'html[data-theme=light] .splash__s0{stop-color:#9a8cff}',
    'html[data-theme=light] .splash__s1{stop-color:#6f5cf0}',
    'html[data-theme=light] .splash__s2{stop-color:#4a36d6}',

    '.splash__mark{display:block;width:clamp(64px,19vw,84px);height:auto;overflow:visible;',
      'filter:drop-shadow(0 0 12px rgb(141 124 255/.5)) drop-shadow(0 0 34px rgb(141 124 255/.26))}',
    '.splash__ring{fill:none;stroke:url(#splash-g);stroke-width:15;opacity:0;',
      'animation:splash-ring calc(.7s*var(--k,1)) ease both,',
      'splash-shimmer 2.6s ease-in-out calc(1.5s*var(--k,1)) infinite}',
    '.splash__ray{fill:none;stroke:url(#splash-g);stroke-width:16;stroke-linecap:round;',
      'stroke-dasharray:var(--L) 400;stroke-dashoffset:var(--L);opacity:0;',
      'animation:splash-ray calc(.55s*var(--k,1)) cubic-bezier(.22,.8,.3,1) calc(var(--d)*var(--k,1)) forwards,',
      'splash-shimmer 2.6s ease-in-out calc((var(--d) + 1.6s)*var(--k,1)) infinite}',

    '@keyframes splash-ring{from{opacity:0}to{opacity:1}}',
    '@keyframes splash-ray{0%{stroke-dashoffset:var(--L);opacity:0}12%{opacity:1}100%{stroke-dashoffset:0;opacity:1}}',
    '@keyframes splash-shimmer{0%,100%{opacity:1}50%{opacity:.5}}',
    '@keyframes splash-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}',
    '@media (prefers-reduced-motion:reduce){.splash__ring,.splash__ray{animation:none;opacity:1;stroke-dashoffset:0}}'
  ].join('');

  // rays: x1, y1, x2, y2, start delay (s), length. Clockwise from the top; the long bottom stem comes last-but-two.
  var rays = [
    [120, 68, 120, 24, 0.30, 44],        // top
    [156.8, 83.2, 187.9, 52.1, 0.42, 44], // top-right
    [172, 120, 216, 120, 0.54, 44],      // right
    [120, 166, 120, 272, 0.66, 106],     // bottom stem (long)
    [68, 120, 24, 120, 0.78, 44],        // left
    [83.2, 83.2, 52.1, 52.1, 0.90, 44]   // top-left
  ];
  var lines = '';
  for (var r = 0; r < rays.length; r++) {
    var q = rays[r];
    lines += '<line class="splash__ray" x1="' + q[0] + '" y1="' + q[1] + '" x2="' + q[2] + '" y2="' + q[3] +
      '" style="--d:' + q[4] + ';--L:' + q[5] + '"/>';
  }
  var mark = '<svg class="splash__mark" viewBox="0 0 240 296" aria-hidden="true" focusable="false">' +
    '<defs><linearGradient id="splash-g" gradientUnits="userSpaceOnUse" x1="0" y1="16" x2="0" y2="280">' +
    '<stop offset="0" class="splash__s0"/><stop offset=".4" class="splash__s1"/><stop offset=".9" class="splash__s2"/>' +
    '</linearGradient></defs>' +
    '<circle class="splash__ring" cx="120" cy="120" r="38.5"/>' + lines + '</svg>';

  var style = document.createElement('style');
  style.id = 'splash-css';
  style.textContent = css;
  var el = document.createElement('div');
  el.id = 'splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading Quiter');
  el.style.setProperty('--k', firstVisit ? '1' : '.45');   // repeat visits: the logo draws faster
  el.innerHTML = mark;

  root.classList.add('is-loading');
  if (intro) root.classList.add('intro-pending');
  root.appendChild(style);
  root.appendChild(el);

  /* ---- readiness ---- */
  var loaded = false, fontsOk = false, finished = false, lastChange = Date.now();
  var photos = {};                       // url -> true once loaded (or failed: never block on a broken photo)

  function onLoaded() {
    loaded = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { fontsOk = true; }, function () { fontsOk = true; });
    } else {
      fontsOk = true;
    }
  }
  if (document.readyState === 'complete') onLoaded(); else window.addEventListener('load', onLoaded);

  var observer = null;
  if (window.MutationObserver) {
    observer = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].addedNodes && list[i].addedNodes.length) { lastChange = Date.now(); return; }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function expectsNav() {
    var s = document.querySelectorAll('script');
    for (var i = 0; i < s.length; i++) if (s[i].textContent.indexOf('initShell') > -1) return true;
    return false;
  }

  function track(url) {
    if (url in photos) return;
    photos[url] = false;
    var im = new Image();
    im.onload = im.onerror = function () { photos[url] = true; };
    im.src = url;
  }

  function nearScreen(node) {
    var r = node.getBoundingClientRect();
    if (!r.width && !r.height) return false;                 // not drawn (display:none / other breakpoint)
    return r.bottom > 0 && r.top < window.innerHeight * 1.2;
  }

  function photosReady() {
    var ok = true, i;
    var imgs = document.querySelectorAll('img');
    for (i = 0; i < imgs.length; i++) {
      if (nearScreen(imgs[i]) && !imgs[i].complete) ok = false;
    }
    var bgs = document.querySelectorAll('[style*="background-image"]');
    for (i = 0; i < bgs.length; i++) {
      var m = /url\((['"]?)(.*?)\1\)/.exec(bgs[i].style.backgroundImage || '');
      if (m && nearScreen(bgs[i])) track(m[2]);
    }
    for (var u in photos) if (!photos[u]) ok = false;
    return ok;
  }

  function ready() {
    if (!loaded || !fontsOk) return false;
    if (expectsNav() && !document.querySelector('header.nav')) return false;
    // Dashboard: wait for the plan cards (or an error message) instead of flashing an empty page.
    var plans = document.getElementById('plans');
    var err = document.getElementById('dash-error');
    if (plans && !plans.children.length && !(err && err.textContent)) return false;
    if (!photosReady()) return false;
    return Date.now() - lastChange >= QUIET_MS;
  }

  function reveal() {
    if (finished) return;
    finished = true;
    if (observer) observer.disconnect();
    var wait = Math.max(0, MIN_MS - (Date.now() - t0));
    setTimeout(function () {
      root.classList.remove('is-loading');
      if (intro) {
        requestAnimationFrame(function () { root.classList.add('intro-play'); });
        setTimeout(function () { root.classList.remove('intro-pending', 'intro-play'); }, 8000);
      }
      setTimeout(function () {                // after the dissolve, remove it for good
        if (el.parentNode) el.parentNode.removeChild(el);
        if (style.parentNode) style.parentNode.removeChild(style);
      }, FADE_MS + 150);
    }, wait);
  }

  var timer = setInterval(function () {
    if (finished) { clearInterval(timer); return; }
    if (ready() || Date.now() - t0 >= MAX_MS) { clearInterval(timer); reveal(); }
  }, 80);

  // Coming back with the Back button (page restored from memory): never show the loading screen or the intro again.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      finished = true;
      root.classList.remove('is-loading', 'intro-pending', 'intro-play');
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  });
})();
