/**
 * Site-wide three.js layer: drifting stars that follow the mouse / your finger, fly past as you
 * scroll, recolour per plan (setGLAccent) and pulse on every tap (pulseGL).
 *
 * ONE fixed full-screen canvas sits behind every page's content, above the flower video.
 * Optional: if the CDN or WebGL is unavailable nothing happens and the site works as before.
 * To self-host three.js, download the file from THREE_URL into assets/vendor/ and change THREE_URL.
 *
 * v2 (more visible): stars are now soft round glows (not 2px squares), vary in size, twinkle,
 * and are tinted between white and the plan accent. Tweak the knobs in the "LOOK" block below.
 */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const ACCENTS = [0x8d7cff, 0x3fe8c9, 0xf8bf40, 0xff6b4a];   // violet, teal, gold, ember (tokens.css)

// ---- LOOK: change these to make the stars bigger / brighter / calmer -------------------------
const LOOK = {
  countDesktop: 320,     // number of stars (was 190)
  countPhone: 140,       // (was 90)
  minSize: 2.6,          // smallest star, in CSS px (phones get +0.4)
  extraSize: 7.5,        // how much bigger the biggest stars can get (most stay small)
  brightness: 0.95,      // base opacity multiplier (1 = full, can go up to ~1.3 for a stronger glow)
  twinkle: 0.3,          // 0 = steady, 0.5 = strong shimmer
  whiteness: 0.35,       // lowest accent tint: lower = whiter stars, 1 = every star fully accent-coloured
};

let ctl = null;
let started = false;
let wantAccent = 0;

// Safe to call before the scene exists (they apply as soon as it does).
export function setGLAccent(i) { wantAccent = i; ctl?.setAccent(i); }
export function pulseGL() { ctl?.pulse(); }

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aTint;
  uniform float uTime;
  uniform float uPx;
  uniform float uBurst;
  uniform float uTwinkle;
  varying float vTw;
  varying float vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (0.7 + aPhase * 1.8) + aPhase * 40.0));
    vTw = tw;
    vTint = aTint;
    gl_PointSize = aSize * uPx * (1.0 + uBurst * 0.7) * (0.85 + 0.3 * tw);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vTw;
  varying float vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;     // 0 at the centre, 1 at the sprite edge
    if (d > 1.0) discard;
    float core = smoothstep(0.38, 0.0, d);           // bright pinpoint
    float glow = pow(1.0 - d, 2.4);                  // soft halo
    float a = (core * 0.95 + glow * 0.6) * vTw * uOpacity;
    vec3 col = mix(vec3(1.0), uColor, vTint);        // white <-> plan accent
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

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
  const anchor = document.querySelector('.bg-veil') || document.querySelector('.bg-scrim');
  anchor ? anchor.after(canvas) : document.body.prepend(canvas);   // after the blur layer, so stars stay crisp

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
  const COUNT = small ? LOOK.countPhone : LOOK.countDesktop;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);    // own slow drift (units / second)
  const par = new Float32Array(COUNT);    // how far each star follows the scroll (depth parallax)
  const size = new Float32Array(COUNT);   // star size in CSS px
  const phase = new Float32Array(COUNT);  // twinkle offset
  const tint = new Float32Array(COUNT);   // 0 = white, 1 = full accent colour
  const minSize = LOOK.minSize + (small ? 0.4 : 0);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = Math.random() - 0.5;
    pos[i * 3 + 1] = Math.random() - 0.5;
    pos[i * 3 + 2] = Math.random() - 0.5;
    const r = Math.random();
    size[i] = minSize + r * r * r * LOOK.extraSize;          // mostly small, a few big bright ones
    vel[i] = 0.004 + (0.4 * Math.random() + 0.6 * r) * 0.014; // big stars feel closer: drift + scroll a bit faster
    par[i] = 0.00010 + (0.4 * Math.random() + 0.6 * r) * 0.00032;
    phase[i] = Math.random();
    tint[i] = LOOK.whiteness + Math.random() * (1 - LOOK.whiteness);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));

  const accent = new THREE.Color(ACCENTS[Math.abs(wantAccent) % ACCENTS.length]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: accent.clone() },
      uTime: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
      uBurst: { value: 0 },
      uOpacity: { value: LOOK.brightness },
      uTwinkle: { value: LOOK.twinkle },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const U = mat.uniforms;

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

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

    U.uColor.value.lerp(accent, 0.04);
    U.uTime.value = t;
    U.uBurst.value = burst;
    U.uOpacity.value = Math.min(1.4, LOOK.brightness + burst * 0.35 + flow * 0.25);

    pts.rotation.y = Math.sin(t * 0.07) * 0.12 + px * 0.2;
    pts.rotation.x = py * 0.12;
    pts.position.x = px * 0.45;
    pts.position.y = py * 0.28;

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