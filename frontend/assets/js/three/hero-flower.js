/**
 * Hero flower stage — scroll-driven crossfade between 3 pre-rendered
 * angle shots (side / top-down / close-up) plus a subtle mouse-parallax
 * tilt and a slow idle "breathing" filter (in CSS). Replaces the
 * real-time Three.js render — same visual intent, far more reliable.
 */

const LAYER_NAMES = ['side', 'top', 'close'];

function initFlowerScroll() {
  const stage = document.getElementById('hero-flower-stage');
  const hero = document.querySelector('.hero');
  if (!stage || !hero) return;

  const layers = LAYER_NAMES
    .map((name) => stage.querySelector(`[data-flower-layer="${name}"]`))
    .filter(Boolean);
  if (layers.length === 0) return;

  let raf = null;

  const update = () => {
    raf = null;
    const heroHeight = hero.offsetHeight;
    const scrollY = window.scrollY || window.pageYOffset;
    const progress = Math.min(1, Math.max(0, scrollY / (heroHeight * 0.9)));

    // 3 layers = 2 crossfade segments: side->top, then top->close.
    const segment = progress * (layers.length - 1);
    layers.forEach((layer, i) => {
      const distance = Math.abs(segment - i);
      layer.style.opacity = Math.max(0, 1 - distance).toFixed(3);
    });
  };

  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

function initFlowerParallax() {
  const stage = document.getElementById('hero-flower-stage');
  if (!stage) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  const maxTilt = 5; // degrees — subtle, not gimmicky

  window.addEventListener('mousemove', (e) => {
    targetX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const animate = () => {
    currentX += (targetX - currentX) * 0.05;
    currentY += (targetY - currentY) * 0.05;
    stage.style.transform = `rotateY(${(currentX * maxTilt).toFixed(2)}deg) rotateX(${(-currentY * maxTilt).toFixed(2)}deg) scale(1.02)`;
    requestAnimationFrame(animate);
  };
  animate();
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    initFlowerScroll();
    initFlowerParallax();
  } catch (e) {
    console.error('[hero flower scene failed]', e);
  }
});