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
const ACCENTS = [0x8d7cff, 0x3fe8c9, 0xf8bf40, 0xff6b4a];
// violet, teal, gold, ember (tokens.css)
// Light theme: additive white glows vanish on a light page, so stars switch to normal blending with
// deeper, more saturated colours (same order as ACCENTS) and an indigo base instead of white.
const ACCENTS_LIGHT = [0x5b46e8, 0x0fa88f, 0xd48a0b, 0xe5502f];
const BASE_DARK = 0xffffff, BASE_LIGHT = 0x2b2a73;

// ---- LOOK: change these to make the stars bigger / brighter / calmer -------------------------
const LOOK = {
countDesktop: 650,     // number of stars
countPhone: 560,       // phones need a lot more to read on a small screen
  minSize: 3.2,          // smallest star, in CSS px (phones get +1.0)
  extraSize: 8.5,        // how much bigger the biggest stars can get (most stay small)
  brightness: 0.95,      // base opacity multiplier (1 = full, can go up to ~1.3 for a stronger glow)
  twinkle: 0.3,          // 0 = steady, 0.5 = strong shimmer
  whiteness: 0.35,       // lowest accent tint: lower = whiter stars, 1 = every star fully accent-coloured
  lightBrightness: 0.80, // star opacity on the light theme (normal blending is stronger than additive)
  lightWhiteness: 0.55,  // on light, fewer stars stay indigo-grey, more carry the accent colour
};

let ctl = null;
let started = false;
let wantAccent = 0;
const isLight = () => document.documentElement.dataset.theme === 'light';

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
  uniform float uWave;      // 0..1 progress of the section wave, -1 = idle
  uniform float uWaveDir;   // +1 = travels up (scrolling down), -1 = travels down
  uniform vec2 uRes;        // canvas size, CSS px
  uniform vec4 uHead;       // flower head: centre x, centre y, radius x, radius y (CSS px)
  uniform vec4 uStem;       // flower stem: x1, y1, x2, y2 (CSS px)
  uniform vec2 uStemFeather; // x = stem radius, y = edge softness (CSS px)
  uniform float uHoleOn;    // 1 on the home page
  varying float vHole;
  varying float vTw;
  varying float vTint;
  varying float vK;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (0.7 + aPhase * 1.8) + aPhase * 40.0));
    // soft band of light that sweeps across the stars when you cross into a new section
    float k = 0.0;
    if (uWave >= 0.0) {
      float ndcY = gl_Position.y / gl_Position.w;
      float front = mix(-1.35, 1.35, uWave) * uWaveDir;
      k = smoothstep(0.55, 0.0, abs(ndcY - front)) * sin(uWave * 3.14159);
      gl_Position.x += sin(ndcY * 5.0 + uWave * 6.0) * 0.012 * k;   // tiny ripple
    }
    // flower mask: stars fade out over the flower (head + stem) and only shine around it
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 sp = vec2((ndc.x * 0.5 + 0.5) * uRes.x, (0.5 - ndc.y * 0.5) * uRes.y);
    float fe = uStemFeather.y;
    float hHole = smoothstep(1.0, 1.0 + fe / max(uHead.z, 1.0), length((sp - uHead.xy) / uHead.zw));
    vec2 sa = uStem.xy, ab = uStem.zw - uStem.xy;
    float tt = clamp(dot(sp - sa, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
    float sHole = smoothstep(0.0, fe, length(sp - (sa + ab * tt)) - uStemFeather.x);
    vHole = mix(1.0, hHole * sHole, uHoleOn);
    vK = k;
    vTw = tw;
    vTint = aTint;
    gl_PointSize = aSize * uPx * (1.0 + uBurst * 0.7 + k * 1.1) * (0.85 + 0.3 * tw);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vHole;
  varying float vTw;
  varying float vTint;
  varying float vK;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;     // 0 at the centre, 1 at the sprite edge
    if (d > 1.0) discard;
    float core = smoothstep(0.38, 0.0, d);           // bright pinpoint
    float glow = pow(1.0 - d, 2.4);                  // soft halo
    float a = (core * 0.95 + glow * 0.6) * vTw * uOpacity * (1.0 + vK * 1.1) * vHole;
    vec3 col = mix(uBase, uColor, vTint);            // base (white / indigo) <-> plan accent
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
  const minSize = LOOK.minSize + (small ? 1.0 : 0);   // phones: bigger base size too
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = Math.random() - 0.5;
    pos[i * 3 + 1] = Math.random() - 0.5;
    pos[i * 3 + 2] = Math.random() - 0.5;
    const r = Math.random();
    size[i] = minSize + r * r * r * LOOK.extraSize;          // mostly small, a few big bright ones
    vel[i] = 0.004 + (0.4 * Math.random() + 0.6 * r) * 0.014; // big stars feel closer: drift + scroll a bit faster
    par[i] = 0.00022 + (0.4 * Math.random() + 0.6 * r) * 0.00062;
    phase[i] = Math.random();
    tint[i] = LOOK.whiteness + Math.random() * (1 - LOOK.whiteness);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));

  const palette = () => (isLight() ? ACCENTS_LIGHT : ACCENTS);
  const accent = new THREE.Color(palette()[Math.abs(wantAccent) % ACCENTS.length]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: accent.clone() },
      uBase: { value: new THREE.Color(isLight() ? BASE_LIGHT : BASE_DARK) },
      uTime: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
      uBurst: { value: 0 },
      uOpacity: { value: isLight() ? LOOK.lightBrightness : LOOK.brightness },
      uTwinkle: { value: LOOK.twinkle },
      uWave: { value: -1 },
      uWaveDir: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uHead: { value: new THREE.Vector4(0, 0, 1, 1) },
      uStem: { value: new THREE.Vector4(0, 0, 0, 0) },
      uStemFeather: { value: new THREE.Vector2(10, 70) },
      uHoleOn: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const U = mat.uniforms;

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  let tx = 0, ty = 0, px = 0, py = 0, burst = 0;
  let wave = -1;   // section wave progress, -1 = idle
  let baseOpacity = isLight() ? LOOK.lightBrightness : LOOK.brightness;
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
    U.uRes.value.set(w, h);
    fitHole();
  }

  // ---- keep stars off the flower: find where it is on screen (CSS px) ----
  // Fractions of the video picture, measured on the poster frames. Nudge these if the gap looks off:
  //   hx/hy = head centre, hr/vr = head half-width/half-height, sx*/sy* = stem ends, sr = stem half-width.
  const FLOWER = {
    desk:  { hx: 0.515, hy: 0.430, hr: 0.200, vr: 0.160, sx1: 0.503, sy1: 0.50, sx2: 0.448, sy2: 1.02, sr: 0.032 },
    phone: { hx: 0.520, hy: 0.429, hr: 0.275, vr: 0.158, sx1: 0.510, sy1: 0.51, sx2: 0.420, sy2: 1.02, sr: 0.040 },
  };
  let holeUntil = performance.now() + 10000;   // follow the flower while the intro reveal settles
  function fitHole() {
    const video = document.querySelector('.bg-video video');
    if (!video || !document.querySelector('.hero')) { U.uHoleOn.value = 0; return; }
    const r = video.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const phoneNow = matchMedia('(max-width: 860px)').matches;
    const f = phoneNow ? FLOWER.phone : FLOWER.desk;
    const iw = video.videoWidth || (phoneNow ? 800 : 1272), ih = video.videoHeight || (phoneNow ? 856 : 952);
    let cw = r.width, ch = r.height, left = r.left, top = r.top;
    if (getComputedStyle(video).objectFit !== 'fill') {   // desktop: object-fit cover, object-position 60% 50%
      const sc = Math.max(r.width / iw, r.height / ih);
      cw = iw * sc; ch = ih * sc;
      left = r.left + (r.width - cw) * 0.6;
      top = r.top + (r.height - ch) * 0.5;
    }
    U.uHead.value.set(left + f.hx * cw, top + f.hy * ch, f.hr * cw, f.vr * ch);
    U.uStem.value.set(left + f.sx1 * cw, top + f.sy1 * ch, left + f.sx2 * cw, top + f.sy2 * ch);
    U.uStemFeather.value.set(f.sr * cw, Math.max(40, 0.05 * cw));   // softness of the edge, px
    U.uHoleOn.value = 1;
  }

  function tick(now) {
    if (!running) return;
    frame = requestAnimationFrame(tick);

    // Fewer frames on phones and when nothing is happening: keeps scrolling + the video smooth.
    const idle = now - lastActive > 3000;
    const fps = small ? (now < fastUntil || idle ? 20 : 30) : (idle ? 30 : 60);
    if (now - last < 1000 / fps - 2) return;
    last = now;
    if (now < holeUntil) fitHole();

    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    const k = 1 - Math.exp(-dt / 0.325);   // same feel as 0.05 at 60fps, identical at any frame rate
    px += (tx - px) * k;
    py += (ty - py) * k;
    burst = Math.max(0, burst - dt * 1.6);
    if (wave >= 0) { wave += dt / 1.3; if (wave >= 1) wave = -1; }
    U.uWave.value = wave;

    // stars fly past as you scroll (near ones faster) and drift upward on their own
    scrollSm += (scrollY - scrollSm) * (1 - Math.exp(-dt / 0.13));
    const dy = scrollSm - lastScroll;
    lastScroll = scrollSm;
    const flow = Math.min(1, Math.abs(dy) * 0.03);

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
    U.uOpacity.value = Math.min(isLight() ? 1.05 : 1.4, baseOpacity + burst * 0.35 + flow * 0.4);

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
  let prevY = scrollY, fastUntil = 0;
  addEventListener('scroll', () => {
    const n = performance.now();
    lastActive = n;
    if (Math.abs(scrollY - prevY) > 40) fastUntil = n + 250;   // hard flick: leave the GPU to the video and the page scroll
    prevY = scrollY;
  }, { passive: true });

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  canvas.addEventListener('webglcontextrestored', start);
  new ResizeObserver(layout).observe(canvas);
  layout();
  start();

  function applyTheme() {   // live theme switch: no re-init, no flicker
    const light = isLight();
    mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.needsUpdate = true;
    U.uBase.value.setHex(light ? BASE_LIGHT : BASE_DARK);
    baseOpacity = light ? LOOK.lightBrightness : LOOK.brightness;
    accent.setHex(palette()[Math.abs(wantAccent) % ACCENTS.length]);
    const w = light ? LOOK.lightWhiteness : LOOK.whiteness;
    for (let i = 0; i < COUNT; i++) tint[i] = w + Math.random() * (1 - w);
    geo.attributes.aTint.needsUpdate = true;
  }
  addEventListener('quiter:theme', applyTheme);
  addEventListener('resize', fitHole);
  addEventListener('quiter:theme', () => setTimeout(fitHole, 400));
  document.addEventListener('loadedmetadata', fitHole, true);
    // crossing into a new home section: light sweeps through the stars and the accent colour moves on
  addEventListener('quiter:section', (e) => {
    const { index = 0, dir = 1 } = e.detail || {};
    wave = 0; U.uWaveDir.value = dir;
    lastActive = performance.now();
    if (index >= 0) { wantAccent = index; accent.setHex(palette()[Math.abs(index) % ACCENTS.length]); }
  });
  if (isLight()) applyTheme();

  ctl = {
    setAccent(i) { accent.setHex(palette()[Math.abs(i) % ACCENTS.length]); },
    pulse() { burst = 1; },
  };
}
