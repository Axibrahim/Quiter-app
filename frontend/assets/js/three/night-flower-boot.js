import { NightFlowerScene } from './night-flower-scene.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('night-flower-canvas');
  if (!canvas) return;

  try {
    const scene = new NightFlowerScene(canvas);
    scene.start();
    scene.initScrollRig('.hero');
    window.addEventListener('pagehide', () => scene.destroy());
  } catch (e) {
    console.error('[night flower scene failed]', e);
  }
});