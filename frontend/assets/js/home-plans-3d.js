/**
 * Ambient three.js layer behind the plans swiper: a glowing halo and drifting particles
 * that sit behind the centred card, recolour per plan and pulse when a plan opens.
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

  // soft glow under the spotlight card
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: ACCENTS[0], transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(glow);

  // halo rings
  const halo = new THREE.Group();
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.006, 12, 180),
    new THREE.MeshBasicMaterial({ color: ACCENTS[0], transparent: true, opacity: 0.55 }));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.14, 0.004, 12, 180),
    new THREE.MeshBasicMaterial({ color: ACCENTS[0], transparent: true, opacity: 0.3 }));
  ring2.rotation.x = 1.1;
  halo.add(ring1, ring2);
  scene.add(halo);

  // drifting particles
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
  let burst = 0, tx = 0, ty = 0, px = 0, py = 0, haloY = 0, haloR = 2;
  let running = false, visible = false, frame = 0;
  const clock = new THREE.Clock();

  function layout() {
    const w = section.clientWidth, h = section.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const s = section.getBoundingClientRect(), t = track.getBoundingClientRect();
    haloY = (0.5 - ((t.top + t.height / 2) - s.top) / s.height) * visH;
    const cardPx = track.querySelector('.spot-card')?.offsetHeight || 420;
    haloR = (cardPx * 0.72 / s.height) * visH;
  }

  function tick() {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    px += (tx - px) * 0.05;
    py += (ty - py) * 0.05;
    burst = Math.max(0, burst - dt * 1.6);

    glow.material.color.lerp(accent, 0.06);
    ring1.material.color.lerp(accent, 0.06);
    ring2.material.color.lerp(accent, 0.06);
    pts.material.color.lerp(accent, 0.03);

    const k = 1 + burst * 0.35;
    halo.position.set(px * 0.25, haloY + py * 0.15, 0);
    halo.scale.setScalar(haloR * k);
    halo.rotation.z = t * 0.12;
    halo.rotation.y = px * 0.4;
    ring2.rotation.z = -t * 0.2;
    glow.position.copy(halo.position);
    glow.scale.setScalar(haloR * 3.2 * k);
    glow.material.opacity = 0.45 + burst * 0.35;
    pts.rotation.y = t * 0.03 + px * 0.15;
    pts.rotation.x = py * 0.08;
    pts.material.opacity = 0.5 + burst * 0.4;

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