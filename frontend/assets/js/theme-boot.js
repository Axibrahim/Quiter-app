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
   Tune the feel with the three numbers below.

   First visit on the home page: when the splash lifts, the html element gets .intro-play and the CSS
   (layout.css, "First-visit intro") runs stars -> hero text -> flower reveal. */
(function () {
  var root = document.documentElement;
  var firstVisit = true;
  try {
    firstVisit = !sessionStorage.getItem('quiter-splash');
    sessionStorage.setItem('quiter-splash', '1');
  } catch (e) { /* private mode */ }

  var MIN_MS = firstVisit ? 500 : 250;   // shortest time the loading screen stays
  var MAX_MS = 4500;                     // longest time, whatever is still loading
  var QUIET_MS = 250;                    // how long the page must stay "still" before we reveal it
  var t0 = Date.now();

  // intro sequence: home page only, first visit of the session, not for reduced-motion users
  var intro = firstVisit && /(^|\/)(index\.html)?$/.test(location.pathname) &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- look: Blue's dot + wordmark + a thin progress sweep, on the theme's own colours ---- */
  var css = [
    'html.is-loading{overflow:hidden}',
    '#splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;',
      'background:radial-gradient(60% 45% at 50% 46%,rgb(141 124 255/.16),transparent 70%),var(--bg,#000);',
      'color:var(--ink,#fff);opacity:1;transition:opacity .45s ease,visibility 0s linear .45s;',
      'animation:splash-failsafe .01s linear ' + ((MAX_MS + 1500) / 1000) + 's forwards}',
    'html[data-theme=light] #splash{background:radial-gradient(60% 45% at 50% 46%,rgb(141 124 255/.14),transparent 70%),var(--bg,#e9ecf6);color:var(--ink,#14161f)}',
    'html:not(.is-loading) #splash{opacity:0;visibility:hidden;pointer-events:none}',
    '.splash__box{display:grid;justify-items:center;gap:1.1rem}',
    '.splash__dot{width:14px;height:14px;border-radius:50%;background:var(--accent-violet,#8d7cff);',
      'box-shadow:0 0 0 0 rgb(141 124 255/.5),0 0 28px rgb(141 124 255/.55);animation:splash-pulse 1.6s ease-out infinite}',
    '.splash__word{font-family:var(--font-serif,Georgia,serif);font-style:italic;font-size:2.6rem;line-height:1;letter-spacing:.01em}',
    '.splash__bar{position:relative;width:120px;height:3px;border-radius:99px;background:rgb(var(--tint,255 255 255)/.14);overflow:hidden}',
    '.splash__bar i{position:absolute;inset:0;width:45%;border-radius:inherit;',
      'background:linear-gradient(90deg,var(--accent-violet,#8d7cff),var(--accent-teal,#3fe8c9));animation:splash-bar 1.1s ease-in-out infinite}',
    '@keyframes splash-pulse{0%{box-shadow:0 0 0 0 rgb(141 124 255/.5),0 0 28px rgb(141 124 255/.55)}',
      '70%,100%{box-shadow:0 0 0 18px rgb(141 124 255/0),0 0 28px rgb(141 124 255/.55)}}',
    '@keyframes splash-bar{0%{transform:translateX(-110%)}100%{transform:translateX(240%)}}',
    '@keyframes splash-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}',
    '@media (prefers-reduced-motion:reduce){.splash__dot,.splash__bar i{animation:none}}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'splash-css';
  style.textContent = css;
  var el = document.createElement('div');
  el.id = 'splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading Quiter');
  el.innerHTML = '<div class="splash__box"><span class="splash__dot"></span>' +
    '<span class="splash__word">Quiter</span><span class="splash__bar"><i></i></span></div>';

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
      setTimeout(function () {                // after the fade-out, remove it for good
        if (el.parentNode) el.parentNode.removeChild(el);
        if (style.parentNode) style.parentNode.removeChild(style);
      }, 800);
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
