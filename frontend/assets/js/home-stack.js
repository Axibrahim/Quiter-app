/**
 * Home: turns the hero + sections into a stack of sheets.
 * Each layer pins to the top of the screen; the next sheet slides up over it, and the covered layer
 * is dimmed/tucked back a little (CSS reads --cover, 0 → 1, which this file sets while you scroll).
 * Tall sheets pin by their BOTTOM edge (negative `top`) so their whole content can be read first.
 * Reduced motion / no JS: nothing is pinned, the sheets are plain rounded blocks.
 */
export function initHomeStack() {
  const main = document.querySelector('main');
  if (!main || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('has-stack');
  let layers = [];
  let queued = false;
  let lastVh = 0;

  const visible = (el) => !el.hidden && getComputedStyle(el).display !== 'none';

  function layout() {
    layers = [...main.children].filter((el) => el.matches('.hero, .section') && visible(el));
    const vh = window.innerHeight;
    lastVh = vh;
    [...main.children].forEach((el) => { if (!layers.includes(el)) el.classList.remove('stack__layer'); });
    layers.forEach((el, i) => {
      el.classList.add('stack__layer');
      el.classList.toggle('is-last', i === layers.length - 1 && el.matches('.section'));
      el.style.top = Math.min(0, vh - el.offsetHeight) + 'px';
    });
    update();
  }

  function update() {
    queued = false;
    const vh = window.innerHeight || 1;
    layers.forEach((el, i) => {
      const next = layers[i + 1];
      let p = 0;
      if (next) p = Math.min(1, Math.max(0, 1 - next.getBoundingClientRect().top / vh));
      p = Math.round(p * 50) / 50;                       // 50 steps: no needless style writes
      if (el._cover !== p) { el._cover = p; el.style.setProperty('--cover', p); el.classList.toggle('is-buried', p >= 1); }
    });
  }

  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { if (Math.abs(window.innerHeight - lastVh) > 80) layout(); else onScroll(); });

  // Sections change height when the plans swiper loads / cards open → re-measure.
  const ro = new ResizeObserver(() => layout());
  ro.observe(main);
  new MutationObserver(layout).observe(main, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  layout();
}