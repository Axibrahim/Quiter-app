/**
 * Scroll-snap "frames" — each major section (hero, about, how-it-works,
 * plans, etc.) becomes a full-screen slide. Deliberately NOT native CSS
 * scroll-snap, since that fights Lenis's virtualized scrolling. Instead:
 * watch scroll via Lenis, wait for momentum to settle (debounce), THEN
 * snap to the nearest frame — so small scroll wiggles don't trigger a
 * jump, only an actual pause/stop does.
 */
function initFrameSnap() {
  const frames = Array.from(document.querySelectorAll('.frame-section'));
  if (frames.length === 0) return;

  const waitForLenis = () => {
    const lenis = window.__lenisInstance;
    if (!lenis) {
      requestAnimationFrame(waitForLenis);
      return;
    }

    let snapTimer = null;
    let isSnapping = false;

    lenis.on('scroll', () => {
      if (isSnapping) return;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        const scrollY = window.scrollY;
        let nearest = frames[0];
        let nearestDist = Infinity;

        frames.forEach((frame) => {
          const dist = Math.abs(frame.offsetTop - scrollY);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = frame;
          }
        });

        // Already essentially there — don't bother animating a snap.
        if (nearestDist < 4) return;

        isSnapping = true;
        lenis.scrollTo(nearest, {
          duration: 0.9,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          onComplete: () => {
            isSnapping = false;
          },
        });
      }, 140); // scroll must pause ~140ms before a snap fires
    });
  };

  waitForLenis();
}

document.addEventListener('DOMContentLoaded', initFrameSnap);