/**
 * Site-wide three.js layer: drifting stars that follow the mouse / your finger, fly past as you
 * scroll, recolour per plan (setGLAccent) and pulse on every tap (pulseGL).
 *
 * ONE fixed full-screen canvas sits behind every page's content, above the flower video.
 * Optional: if the CDN or WebGL is unavailable nothing happens and the site works as before.
 * To self-host three.js, download the file from THREE_URL into assets/vendor/ and change THREE_URL.
 */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const ACCENTS = [0x8d7cff, 0x3fe8c9, 0xf8bf40, 0xff6b4a];   // violet, teal, gold, ember (tokens.css)

let ctl = null;
let started = false;
let wantAccent = 0;

// Safe to call before the scene exists (they apply as soon as it does).
export function setGLAccent(i) { wantAccent = i; ctl?.setAccent(i); }
export function pulseGL() { ctl?.pulse(); }

export async function initSiteGL() {
  if (started) return;
  started = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let THREE;
  try { THREE = await import(THREE_URL); } catch { return; }

  const small = matchMedia('(max-width: 860px)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'site-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const scrim = document.querySelector('.bg-scrim');
  scrim ? scrim.after(canvas) : document.body.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !small, powerPreference: 'low-power' });
  } catch { canvas.remove(); return; }

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1 : 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 10;

  // Stars live in a unit cube; layout() stretches it to cover whatever the screen shape is.
  const COUNT = small ? 90 : 190;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);   // own slow drift (units / second)
  const par = new Float32Array(COUNT);   // how far each star follows the scroll (depth parallax)
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = Math.random() - 0.5;
    pos[i * 3 + 1] = Math.random() - 0.5;
    pos[i * 3 + 2] = Math.random() - 0.5;
    vel[i] = 0.004 + Math.random() * 0.012;
    par[i] = 0.00012 + Math.random() * 0.0002;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.06, color: ACCENTS[0], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  scene.add(pts);

  const accent = new THREE.Color(ACCENTS[Math.abs(wantAccent) % ACCENTS.length]);
  pts.material.color.copy(accent);

  let tx = 0, ty = 0, px = 0, py = 0, burst = 0;
  let scrollSm = scrollY, lastScroll = scrollY;
  let lastActive = performance.now();
  let running = false, frame = 0, last = 0, first = true;
  const clock = new THREE.Clock();

  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    pts.scale.set(visH * camera.aspect * 1.35, visH * 1.35, 6);
  }

  function tick(now) {
    if (!running) return;
    frame = requestAnimationFrame(tick);

    // Fewer frames on phones and when nothing is happening: keeps scrolling + the video smooth.
    const idle = now - lastActive > 3000;
    const fps = small ? (idle ? 20 : 30) : (idle ? 30 : 60);
    if (now - last < 1000 / fps - 2) return;
    last = now;

    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    px += (tx - px) * 0.05;
    py += (ty - py) * 0.05;
    burst = Math.max(0, burst - dt * 1.6);

    // stars fly past as you scroll (near ones faster) and drift upward on their own
    scrollSm += (scrollY - scrollSm) * 0.12;
    const dy = scrollSm - lastScroll;
    lastScroll = scrollSm;
    const flow = Math.min(1, Math.abs(dy) * 0.02);

    const a = geo.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3 + 1;
      let y = a[k] + vel[i] * dt + dy * par[i];
      if (y > 0.5) y -= 1; else if (y < -0.5) y += 1;
      a[k] = y;
    }
    geo.attributes.position.needsUpdate = true;

    pts.material.color.lerp(accent, 0.04);
    pts.rotation.y = Math.sin(t * 0.07) * 0.12 + px * 0.2;
    pts.rotation.x = py * 0.12;
    pts.position.x = px * 0.45;
    pts.position.y = py * 0.28;
    pts.material.opacity = Math.min(1, 0.5 + burst * 0.4 + flow * 0.2);
    pts.material.size = 0.06 * (1 + burst * 0.6);

    renderer.render(scene, camera);
    if (first) { first = false; canvas.classList.add('is-on'); }
  }

  const start = () => { if (running || document.hidden) return; running = true; clock.getDelta(); frame = requestAnimationFrame(tick); };
  const stop = () => { running = false; cancelAnimationFrame(frame); };

  // mouse + finger: stars lean toward the pointer; a tap makes them flash
  const aim = (cx, cy) => {
    tx = (cx / innerWidth - 0.5) * 2;
    ty = (cy / innerHeight - 0.5) * -2;
    lastActive = performance.now();
  };
  addEventListener('pointermove', (e) => aim(e.clientX, e.clientY), { passive: true });
  addEventListener('pointerdown', (e) => { aim(e.clientX, e.clientY); burst = 1; }, { passive: true });
  addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { tx = 0; ty = 0; } }, { passive: true });
  addEventListener('touchmove', (e) => { const f = e.touches[0]; if (f) aim(f.clientX, f.clientY); }, { passive: true });
  addEventListener('scroll', () => { lastActive = performance.now(); }, { passive: true });

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  canvas.addEventListener('webglcontextrestored', start);
  new ResizeObserver(layout).observe(canvas);
  layout();
  start();

  ctl = {
    setAccent(i) { accent.setHex(ACCENTS[Math.abs(i) % ACCENTS.length]); },
    pulse() { burst = 1; },
  };
}