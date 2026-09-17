/**
 * Full-screen nav overlay, McLaren-reference-inspired: toggle morphs to an
 * X, big stacked uppercase links stagger in, and a Three.js shader plane
 * renders a slow flowing "liquid glass" background behind them — tinted
 * to Quiter's violet/teal, matching the liquid-glass panels used
 * everywhere else on the site.
 *
 * Deliberately a fullscreen-quad fragment shader, not a 3D model — no
 * geometry, no lighting, no normals to get wrong. Only runs while the
 * menu is open; the render loop is fully torn down on close so it costs
 * nothing the rest of the time.
 */
import * as THREE from 'three';

let scene, camera, renderer, material, raf, startTime;

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;

  void main() {
    vec2 uv = vUv;
    uv.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.06;

    float wave1 = sin(uv.x * 3.0 + t * 2.0) * 0.5 + 0.5;
    float wave2 = sin(uv.y * 4.0 - t * 1.4) * 0.5 + 0.5;
    float wave3 = sin((uv.x + uv.y) * 2.2 + t * 1.8) * 0.5 + 0.5;
    float blend = (wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25);

    vec3 violet = vec3(0.553, 0.486, 1.0);
    vec3 teal   = vec3(0.247, 0.910, 0.788);
    vec3 dark   = vec3(0.02, 0.02, 0.035);

    vec3 color = mix(dark, mix(violet, teal, wave2), blend * 0.5);

    // Soft vignette so the corners stay near-black, keeping the text readable
    float vignette = smoothstep(1.1, 0.2, length(vUv - 0.5) * 1.4);
    color *= vignette;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function initScene(canvas) {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(canvas.clientWidth, canvas.clientHeight) },
    },
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  resize(canvas);
  startTime = performance.now();
}

function resize(canvas) {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  material.uniforms.uResolution.value.set(clientWidth, clientHeight);
}

function animate() {
  material.uniforms.uTime.value = (performance.now() - startTime) / 1000;
  renderer.render(scene, camera);
  raf = requestAnimationFrame(animate);
}

function startShader(canvas) {
  if (renderer) return; // already running
  try {
    initScene(canvas);
    animate();
  } catch (e) {
    console.error('[site menu shader failed]', e);
  }
}

function stopShader() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  if (material) {
    material.dispose();
    material = null;
  }
}

function initSiteMenu() {
  const toggle = document.getElementById('site-menu-toggle');
  const menu = document.getElementById('site-menu');
  const canvas = document.getElementById('site-menu-canvas');
  const links = document.querySelectorAll('[data-menu-link]');
  if (!toggle || !menu || !canvas) return;

  let isOpen = false;

  const openMenu = () => {
    isOpen = true;
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    toggle.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    startShader(canvas);

    if (window.gsap) {
      window.gsap.fromTo(
        links,
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, stagger: 0.08, ease: 'power3.out', delay: 0.1 }
      );
    }
  };

  const closeMenu = () => {
    isOpen = false;
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    stopShader();
  };

  toggle.addEventListener('click', () => (isOpen ? closeMenu() : openMenu()));
  links.forEach((link) => link.addEventListener('click', closeMenu));

  window.addEventListener('resize', () => {
    if (isOpen && canvas) resize(canvas);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeMenu();
  });
}

document.addEventListener('DOMContentLoaded', initSiteMenu);