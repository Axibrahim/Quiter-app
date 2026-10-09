/**
 * Ambient three.js layer behind the plans swiper: drifting stars that follow the pointer,
 * recolour per plan and pulse when a plan opens. (The halo / rings object was removed.)
 * Optional: returns null if the CDN or WebGL is unavailable (the swiper works without it).
 * To self-host, download this file from the URL below into assets/vendor/ and change THREE_URL.
 */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const ACCENTS = [0x8d7cff, 0x3fe8c9, 0xf8bf40, 0xff6b4a];   // violet, teal, gold, ember (tokens.css)

export async function initShowcaseGL(canvas, section, track) {
  if (!canvas) return null;
  let THREE;
  try { THREE = await import(THREE_URL); } catch { return null; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch { return null; }

  const small = matchMedia('(max-width: 760px)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 10;

  // drifting stars
  const COUNT = small ? 70 : 150;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 18;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.06, color: ACCENTS[1], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(pts);

  const accent = new THREE.Color(ACCENTS[0]);
  let burst = 0, tx = 0, ty = 0, px = 0, py = 0;
  let running = false, visible = false, frame = 0;
  const clock = new THREE.Clock();

  function layout() {
    const w = section.clientWidth, h = section.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function tick() {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    px += (tx - px) * 0.05;
    py += (ty - py) * 0.05;
    burst = Math.max(0, burst - dt * 1.6);

    pts.material.color.lerp(accent, 0.04);

    // stars drift slowly and follow the pointer / finger (parallax)
    pts.rotation.y = t * 0.03 + px * 0.25;
    pts.rotation.x = py * 0.14;
    pts.position.x = px * 0.45;
    pts.position.y = py * 0.28;
    pts.material.opacity = 0.5 + burst * 0.4;
    pts.material.size = 0.06 * (1 + burst * 0.6);

    renderer.render(scene, camera);
  }

  const start = () => { if (running || !visible || document.hidden) return; running = true; clock.getDelta(); tick(); };
  const stop = () => { running = false; cancelAnimationFrame(frame); };

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(section);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  new ResizeObserver(layout).observe(section);
  section.addEventListener('pointermove', (e) => {
    const r = section.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * -2;
  }, { passive: true });
  layout();

  return {
    setAccent(i) { accent.setHex(ACCENTS[Math.abs(i) % ACCENTS.length]); },
    pulse() { burst = 1; },
  };
}