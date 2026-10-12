/**
 * Home intro: the hero is pinned and the first section slides up over it.
 * --cover (0 → 1) on the hero tells CSS how much it is covered, so it can fade out smoothly.
 * Everything after the first section is a normal glass frame (pure CSS, nothing to do here).
 * Reduced motion / no JS: nothing is pinned.
 */
export function initHomeStack() {
  const main = document.querySelector('main');
  const hero = main && main.querySelector(':scope > .hero');
  if (!hero || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('has-stack');
  hero.classList.add('stack__layer');

  let next = null;
  let queued = false;
  let last = -1;

  const findNext = () => [...main.children].find((el) => el.matches('.section') && !el.hidden && getComputedStyle(el).display !== 'none') || null;

  function layout() {
    next = findNext();
    // a hero taller than the screen pins by its bottom edge, so all of it can be read first
    hero.style.top = Math.min(0, window.innerHeight - hero.offsetHeight) + 'px';
    update();
  }

  function update() {
    queued = false;
    const vh = window.innerHeight || 1;
    let p = next ? Math.min(1, Math.max(0, 1 - next.getBoundingClientRect().top / vh)) : 0;
    p = Math.round(p * 200) / 200;                     // 200 steps: smooth fade, still no needless style writes
    if (p === last) return;
    last = p;
    hero.style.setProperty('--cover', p);
    hero.classList.toggle('is-buried', p >= 1);
  }

  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  // phones fire "resize" whenever the browser toolbar slides in/out while you scroll; that must not re-layout (it caused jumps)
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW && matchMedia('(pointer: coarse)').matches) { update(); return; }
    lastW = window.innerWidth;
    layout();
  });
  new MutationObserver(layout).observe(main, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  layout();
}