/**
 * Hero galaxy field — ambient background behind the flower crossfade.
 * Adapted from a much heavier reference spec (200k points, 3 bloom
 * composers) down to something that actually holds 60fps as a
 * persistent background: ~28k points, single bloom pass, Quiter's
 * palette instead of the reference's pastel colors.
 */
import * as THREE from 'three';
import { EffectComposer } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass.js';

const hexToVec3 = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const VERTEX_SHADER = `
  attribute float size;
  attribute float id;
  attribute float shell;
  uniform float iTime;
  uniform float uWobbleAmount;
  uniform float uWobbleSpeed;
  varying float vShell;
  varying float vId;
  void main() {
    vShell = shell; vId = id;
    float ph = id * 6.2831853;
    vec3 wob = vec3(
      sin(iTime * uWobbleSpeed + ph),
      cos(iTime * uWobbleSpeed * 1.3 + ph),
      sin(iTime * uWobbleSpeed * 0.7 + ph)
    ) * uWobbleAmount;
    vec4 mv = modelViewMatrix * vec4(position + wob, 1.0);
    gl_PointSize = size / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = `
  uniform float iTime;
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uRim;
  uniform vec3 uTwinkle;
  uniform float uTwinkleAmount;
  uniform float uTwinkleSpeed;
  varying float vShell;
  varying float vId;
  vec3 grad3(vec3 a, vec3 b, vec3 c, float t) {
    return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, clamp((t - 0.5) * 2.0, 0.0, 1.0));
  }
  void main() {
    float t = pow(vShell, 0.35);
    vec3 col = grad3(uCore, uMid, uRim, t);
    float tw = 0.5 + 0.5 * sin(iTime * uTwinkleSpeed + vId * 100.0);
    col = mix(col, uTwinkle, tw * uTwinkleAmount * (1.0 - t));
    col *= (0.4 + 0.75 * (1.0 - t));
    float tex = 1.0 - smoothstep(0.5, 1.0, length(2.0 * gl_PointCoord - 1.0));
    gl_FragColor = vec4(col * tex, tex * 0.85);
  }
`;

export class HeroGalaxy {
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = window.innerWidth < 760;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 80);
    this.camera.position.z = 14;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.5, 0.4, 0
    );
    this.composer.addPass(this.bloom);

    this._buildField();

    this.scrollTarget = 0;
    this.scrollCurrent = 0;
    this._onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      this.scrollTarget = Math.min(1, Math.max(0, window.scrollY / Math.max(1, max)));
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._raf = null;
  }

  _buildField() {
    const N = this.isMobile ? 12000 : 28000; // scaled down from the 200k reference for real perf
    const K = 40; // galaxy "frames" — scaled down from 107
    const SP = 12.5;
    const R = 1.7;

    const positions = new Float32Array(N * 3);
    const shells = new Float32Array(N);
    const sizes = new Float32Array(N);
    const ids = new Float32Array(N);

    const frames = [];
    for (let k = 0; k < K; k++) {
      frames.push({
        m: new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
          Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI
        )),
        size: 0.18 + 0.34 * Math.random(),
        ecc: 0.45 + 0.42 * Math.random(),
        thick: 0.06 + 0.05 * Math.random(),
        ox: (Math.random() - 0.5) * 2 * SP,
        oy: (Math.random() - 0.5) * 2 * SP,
        oz: (Math.random() - 0.5) * 2 * SP * 0.6,
      });
    }

    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const f = frames[i % K];
      const th = Math.random() * Math.PI * 2;
      const rad = Math.pow(Math.random(), 1.4);
      const rx = f.size * R * rad;
      const rz = f.size * R * f.ecc * rad;
      const y = (Math.random() - 0.5) * 2 * f.thick * R * rad;
      tmp.set(rx * Math.cos(th), y, rz * Math.sin(th)).applyMatrix4(f.m);
      tmp.x += f.ox; tmp.y += f.oy; tmp.z += f.oz;
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
      shells[i] = rad;
      sizes[i] = 5 + 7 * Math.random();
      ids[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('shell', new THREE.BufferAttribute(shells, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('id', new THREE.BufferAttribute(ids, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true,
      uniforms: {
        iTime: { value: 0 },
        uWobbleAmount: { value: 0.2 },
        uWobbleSpeed: { value: 0.35 },
        // Quiter palette, not the reference spec's pastel colors:
        uCore: { value: hexToVec3('#ffffff') },
        uMid: { value: hexToVec3('#8d7cff') },   // brand violet
        uRim: { value: hexToVec3('#0a0716') },
        uTwinkle: { value: hexToVec3('#3fe8c9') }, // brand teal
        uTwinkleAmount: { value: 0.7 },
        uTwinkleSpeed: { value: 2.2 },
      },
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.position.z = -6;
    this.scene.add(this.points);
    this.geo = geo;
  }

  start() {
    const startTime = performance.now();
    const animate = () => {
      this._raf = requestAnimationFrame(animate);
      const t = performance.now() / 1000;

      this.scrollCurrent += (this.scrollTarget - this.scrollCurrent) * 0.08;
      this.camera.position.z = 14 - this.scrollCurrent * 4;

      this.material.uniforms.iTime.value = t;
      const spin = 0.06 * (1 + this.scrollCurrent * 2.6) * 0.016;
      this.points.rotation.y += spin;
      this.points.rotation.x += spin * 0.35;

      this.composer.render();
    };
    animate();
  }

  _onResize() {
    const { clientWidth, clientHeight } = this.canvas;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.composer.setSize(clientWidth, clientHeight);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll);
    this.geo.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}