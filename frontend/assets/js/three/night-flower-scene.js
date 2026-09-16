/**
 * NightFlowerScene — cinematic night-sky hero replacing the flat MP4.
 *
 * Scene: deep midnight-blue sky, a soft-glowing full moon, a sparse
 * hand-placed star field, subtle exponential fog standing in for
 * atmospheric haze. One soft key light from above/side reveals the
 * flower's chrome; a dim cool light near the moon acts as rim fill.
 * Deliberately restrained — no bloom/glow post-processing, no dense
 * particle fields. The flower carries the scene, not the effects.
 *
 * PLACEHOLDER GEOMETRY: until the real .glb lands in
 * assets/media/models/glass-flower.glb, buildPlaceholderFlower() draws a
 * stand-in from primitives so lighting/camera/composition can be tuned
 * today. loadRealFlower() silently no-ops if that file 404s — drop the
 * real model in and reload, nothing else needs to change.
 *
 * MEMORY DISCIPLINE: same convention as bloom-scene.js — every
 * geometry/material/texture is tracked and disposed in destroy().
 */
import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = 'assets/media/glass-flower.glb';

export class NightFlowerScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.disposables = [];
    this.isMobile = window.innerWidth < 760;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03040a); // deep midnight-blue-black
    this.scene.fog = new THREE.FogExp2(0x050810, this.isMobile ? 0.035 : 0.028);

    this.camera = new THREE.PerspectiveCamera(
      38,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.flowerGroup = new THREE.Group();
    this.scene.add(this.flowerGroup);

    this._buildMoon();
    this._buildStars();
    this._buildLights();
    this._buildPlaceholderFlower();
    this._loadRealFlowerIfAvailable();
    this._setCameraHome();

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this._scrollRig = null;
    this._raf = null;
  }

  // ---- Moon --------------------------------------------------------

  _buildMoon() {
    const moonGeo = new THREE.SphereGeometry(3.2, 48, 48);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xdedbe6,
      emissive: 0x9d9aad,
      emissiveIntensity: 0.7,
      roughness: 0.9,
      metalness: 0,
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(6, 7, -18);
    this.scene.add(moon);
    this.disposables.push(moonGeo, moonMat);

    // Soft glow halo — a single additive-blended sprite, not a bloom pass.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 256;
    const ctx = glowCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(220,220,235,0.35)');
    grad.addColorStop(1, 'rgba(220,220,235,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(14, 14, 1);
    glow.position.copy(moon.position);
    this.scene.add(glow);
    this.disposables.push(glowTex, glowMat);

    this.moon = moon;
  }

  // ---- Stars — sparse, not a dense field ----------------------------

  _buildStars() {
    const starCount = this.isMobile ? 26 : 42;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const radius = 30 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.6 + 0.2); // bias upward, away from the flower
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 4;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 10;
    }

    const starCanvas = document.createElement('canvas');
    starCanvas.width = starCanvas.height = 32;
    const sctx = starCanvas.getContext('2d');
    const sgrad = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    sgrad.addColorStop(0, 'rgba(255,255,255,1)');
    sgrad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    sgrad.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 32, 32);
    const starTex = new THREE.CanvasTexture(starCanvas);

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.35,
      map: starTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.stars = new THREE.Points(starGeo, starMat);
    this.scene.add(this.stars);
    this.disposables.push(starGeo, starMat, starTex);
  }

  // ---- Lighting — one key, one dim rim, minimal ambient -------------

  _buildLights() {
    const key = new THREE.DirectionalLight(0xfff2df, 3.2);
    key.position.set(5, 9, 6);
    key.castShadow = !this.isMobile;
    if (key.castShadow) {
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 30;
      key.shadow.radius = 3;
    }
    this.scene.add(key);

    // A second, softer key from the opposite side so the flower doesn't
    // vanish into black on its unlit side — still dimmer than the main
    // key so it reads as fill, not a second sun.
    const fill = new THREE.DirectionalLight(0xd8e0ff, 1.1);
    fill.position.set(-5, 4, 4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xaeb8ff, 0.9);
    rim.position.set(-6, 6, -12); // roughly from the moon's direction
    this.scene.add(rim);

    const ambient = new THREE.HemisphereLight(0x2a3050, 0x0a0a10, 0.55);
    this.scene.add(ambient);

    this.keyLight = key;
  }

  // ---- Placeholder flower (swapped out once the real .glb loads) ----

  _buildPlaceholderFlower() {
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8dade,
      metalness: 1,
      roughness: 0.18,
      envMapIntensity: 1,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xcda45e,
      metalness: 0.85,
      roughness: 0.32,
    });

    const petalGeo = new THREE.SphereGeometry(1, 24, 24, 0, Math.PI * 1.1, 0, Math.PI * 0.55);
    const petalCount = 8;
    for (let i = 0; i < petalCount; i++) {
      const petal = new THREE.Mesh(petalGeo, chromeMat);
      petal.scale.set(0.55, 1.5, 0.22);
      const angle = (i / petalCount) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.4, 0.3, Math.sin(angle) * 0.4);
      petal.rotation.z = Math.cos(angle) * 0.5;
      petal.rotation.x = Math.sin(angle) * 0.5;
      petal.rotation.y = -angle;
      petal.castShadow = petal.receiveShadow = !this.isMobile;
      this.flowerGroup.add(petal);
    }
    this.disposables.push(petalGeo);

    const centerGeo = new THREE.IcosahedronGeometry(0.45, 2);
    const center = new THREE.Mesh(centerGeo, chromeMat);
    center.position.y = 0.3;
    center.castShadow = center.receiveShadow = !this.isMobile;
    this.flowerGroup.add(center);
    this.disposables.push(centerGeo);

    const stemGeo = new THREE.CylinderGeometry(0.06, 0.09, 3.2, 16);
    const stem = new THREE.Mesh(stemGeo, goldMat);
    stem.position.y = -1.6;
    stem.castShadow = stem.receiveShadow = !this.isMobile;
    this.flowerGroup.add(stem);
    this.disposables.push(stemGeo);

    this.disposables.push(chromeMat, goldMat);
  }

  _loadRealFlowerIfAvailable() {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_PATH,
      (gltf) => {
        while (this.flowerGroup.children.length) {
          this.flowerGroup.remove(this.flowerGroup.children[0]);
        }

        const model = gltf.scene;

        model.traverse((node) => {
          if (!node.isMesh) return;

          // This model ships without vertex normals — without this,
          // lighting renders flat/wrong regardless of light setup.
          if (!node.geometry.attributes.normal) {
            node.geometry.computeVertexNormals();
          }

          node.castShadow = node.receiveShadow = !this.isMobile;

          // TEMPORARY DIAGNOSTIC — bypasses lighting/normals entirely to
          // isolate whether the problem is materials or geometry/scale.
          node.material = new THREE.MeshBasicMaterial({
            color: 0xff8222,
            side: THREE.DoubleSide,
            wireframe: false,
          });
        });

        // Auto-center and auto-scale based on the model's REAL bounding
        // box, rather than a hardcoded guess — this keeps it framed
        // correctly even if the model is re-exported at a different scale.
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        model.position.sub(center); // center the model on the origin

        const targetHeight = 2.4;
        const scaleFactor = targetHeight / Math.max(size.y, 0.001);
        model.scale.setScalar(scaleFactor);

        this.flowerGroup.add(model);
        this._applyEnvironment();
      },
      undefined,
      () => {
        // 404 or load error — placeholder stays, silently.
      }
    );
  }

  /**
   * A flat-lit chrome surface with no environment map looks dull no
   * matter how good the direct lighting is — reflections are what sell
   * "chrome". This bakes a cheap synthetic environment (a simple
   * gradient sky, not the full scene) into a PMREM so the petals pick up
   * believable reflections without a real HDRI asset.
   */
  _applyEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const gradientGeo = new THREE.SphereGeometry(20, 16, 16);
    const gradientMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x3a4160) },
        bottom: { value: new THREE.Color(0x030308) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 top;
        uniform vec3 bottom;
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          gl_FragColor = vec4(mix(bottom, top, h), 1.0);
        }
      `,
    });
    envScene.add(new THREE.Mesh(gradientGeo, gradientMat));

    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = envMap;

    gradientGeo.dispose();
    gradientMat.dispose();
    pmrem.dispose();
  }

  // ---- Camera ---------------------------------------------------------

  _setCameraHome() {
    // Cinematic side + slightly top-down, not front-facing.
    this.camera.position.set(3.4, 2.1, 5.2);
    this.camera.lookAt(0, 0.1, 0);
  }

  /**
   * Wires camera movement to scroll progress through the hero section via
   * GSAP ScrollTrigger (already loaded on the page). Three restrained
   * keyframes: home → slight orbit closer → detail shot on the center.
   * Call this once GSAP/ScrollTrigger are confirmed loaded.
   */
  initScrollRig(triggerSelector) {
    if (!window.gsap || !window.ScrollTrigger) return;

    const state = { t: 0 };
    const positions = [
      { x: 3.4, y: 2.1, z: 5.2, lx: 0, ly: 0.1, lz: 0 },
      { x: -2.6, y: 2.8, z: 4.0, lx: 0, ly: 0.2, lz: 0 },
      { x: 0.6, y: 1.1, z: 2.4, lx: 0, ly: 0.35, lz: 0 },
    ];

    window.gsap.timeline({
      scrollTrigger: {
        trigger: triggerSelector,
        start: 'top top',
        end: 'bottom top',
        scrub: 1.2,
      },
    }).to(state, {
      t: positions.length - 1,
      ease: 'none',
      onUpdate: () => {
        const t = state.t;
        const i = Math.min(Math.floor(t), positions.length - 2);
        const f = t - i;
        const a = positions[i];
        const b = positions[i + 1];

        this.camera.position.set(
          a.x + (b.x - a.x) * f,
          a.y + (b.y - a.y) * f,
          a.z + (b.z - a.z) * f
        );
        this.camera.lookAt(
          a.lx + (b.lx - a.lx) * f,
          a.ly + (b.ly - a.ly) * f,
          a.lz + (b.lz - a.lz) * f
        );
      },
    });
  }

  start() {
    const animate = () => {
      this._raf = requestAnimationFrame(animate);
      this.flowerGroup.rotation.y += 0.0009; // barely-there ambient drift, not a spin
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  _onResize() {
    const { clientWidth, clientHeight } = this.canvas;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.disposables.forEach((d) => d.dispose?.());
    this.renderer.dispose();
  }
}