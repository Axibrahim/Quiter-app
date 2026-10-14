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

   First visit on the home page: when the splash lifts, the html element gets .intro-play and the CSS
   (layout.css, "First-visit intro") runs stars -> hero text -> flower reveal. */
(function () {
  var root = document.documentElement;
  var firstVisit = true;
  try {
    firstVisit = !sessionStorage.getItem('quiter-splash');
    sessionStorage.setItem('quiter-splash', '1');
  } catch (e) { /* private mode */ }

  var MIN_MS = firstVisit ? 900 : 300;   // shortest time the loading screen stays
  var MAX_MS = 4500;                     // longest time, whatever is still loading
  var QUIET_MS = 250;                    // how long the page must stay "still" before we reveal it
  var FADE_MS = 700;                     // how long the splash takes to dissolve
  var t0 = Date.now();

  // intro sequence: home page only, first visit of the session, not for reduced-motion users
  var intro = firstVisit && /(^|\/)(index\.html)?$/.test(location.pathname) &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- look: glass orb + soft ring + twinkling stars + serif wordmark, on the theme's own colours ---- */
  var fade = (FADE_MS / 1000) + 's';
  var css = [
    'html.is-loading{overflow:hidden}',
    '#splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;overflow:hidden;',
      'background:radial-gradient(55% 40% at 50% 44%,rgb(141 124 255/.20),transparent 70%),',
      'radial-gradient(40% 30% at 62% 62%,rgb(63 232 201/.09),transparent 70%),var(--bg,#000);',
      'color:var(--ink,#fff);opacity:1;filter:blur(0);transform:none;',
      'transition:opacity ' + fade + ' ease,filter ' + fade + ' ease,transform ' + fade + ' ease,visibility 0s linear ' + fade + ';',
      'animation:splash-failsafe .01s linear ' + ((MAX_MS + 1500) / 1000) + 's forwards}',
    'html[data-theme=light] #splash{background:radial-gradient(55% 40% at 50% 44%,rgb(141 124 255/.16),transparent 70%),',
      'radial-gradient(40% 30% at 62% 62%,rgb(63 232 201/.10),transparent 70%),var(--bg,#e9ecf6);color:var(--ink,#14161f)}',
    'html:not(.is-loading) #splash{opacity:0;visibility:hidden;pointer-events:none;filter:blur(10px);transform:scale(1.03)}',

    '.splash__stars{position:absolute;inset:0;pointer-events:none}',
    '.splash__stars i{position:absolute;border-radius:50%;background:currentColor;opacity:0;',
      'animation:splash-twinkle var(--t,3s) ease-in-out var(--d,0s) infinite}',

    '.splash__box{position:relative;display:grid;justify-items:center;gap:1.7rem}',
    '.splash__orb{position:relative;width:84px;height:84px;border-radius:50%;',
      'background:radial-gradient(circle at 32% 28%,rgb(255 255 255/.55),rgb(255 255 255/0) 38%),',
        'radial-gradient(circle at 70% 78%,rgb(63 232 201/.45),transparent 55%),',
        'radial-gradient(circle at 40% 40%,rgb(141 124 255/.75),rgb(141 124 255/.25) 70%);',
      'box-shadow:inset 0 0 0 1px rgb(255 255 255/.28),inset 0 -10px 22px rgb(0 0 0/.18),',
        '0 0 46px rgb(141 124 255/.45),0 0 120px rgb(141 124 255/.22);',
      'animation:splash-breathe 3.2s ease-in-out infinite}',
    '.splash__orb::after{content:"";position:absolute;inset:-10px;border-radius:50%;',
      'border:1px solid rgb(var(--tint,255 255 255)/.14);border-top-color:var(--accent-teal,#3fe8c9);',
      'animation:splash-spin 2.4s linear infinite}',
    '.splash__word{font-family:var(--font-serif,Georgia,serif);font-style:italic;font-size:2.4rem;line-height:1;',
      'letter-spacing:.04em;opacity:0;animation:splash-word .9s ease .15s forwards}',

    '@keyframes splash-twinkle{0%,100%{opacity:0;transform:scale(.5)}50%{opacity:.85;transform:scale(1)}}',
    '@keyframes splash-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}',
    '@keyframes splash-spin{to{transform:rotate(360deg)}}',
    '@keyframes splash-word{from{opacity:0;transform:translateY(8px);letter-spacing:.14em}to{opacity:1;transform:none;letter-spacing:.04em}}',
    '@keyframes splash-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}',
    '@media (prefers-reduced-motion:reduce){.splash__stars i,.splash__orb,.splash__orb::after{animation:none}',
      '.splash__stars i{opacity:.5}.splash__word{animation:none;opacity:1}}'
  ].join('');

  // a fixed scatter of small stars (same layout every time, no randomness needed)
  var stars = '', seed = 7;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  for (var s = 0; s < 28; s++) {
    var sz = (1.5 + rnd() * 2.5).toFixed(1);
    stars += '<i style="left:' + (rnd() * 100).toFixed(1) + '%;top:' + (rnd() * 100).toFixed(1) + '%;' +
      'width:' + sz + 'px;height:' + sz + 'px;--t:' + (2.4 + rnd() * 2).toFixed(1) + 's;--d:' + (rnd() * 3).toFixed(1) + 's"></i>';
  }

  var style = document.createElement('style');
  style.id = 'splash-css';
  style.textContent = css;
  var el = document.createElement('div');
  el.id = 'splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading Quiter');
  el.innerHTML = '<div class="splash__stars">' + stars + '</div>' +
    '<div class="splash__box"><span class="splash__orb"></span><span class="splash__word">Quiter</span></div>';

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
