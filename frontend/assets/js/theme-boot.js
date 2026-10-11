/* Runs in <head> before first paint so there's no dark->light flash. Keep it tiny and classic (not a module). */
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