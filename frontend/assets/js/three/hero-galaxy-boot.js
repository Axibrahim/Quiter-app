import { HeroGalaxy } from './hero-galaxy.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('hero-galaxy-canvas');
  if (!canvas) return;
  try {
    const galaxy = new HeroGalaxy(canvas);
    galaxy.start();
    window.addEventListener('pagehide', () => galaxy.destroy());
  } catch (e) {
    console.error('[hero galaxy failed]', e);
  }
});