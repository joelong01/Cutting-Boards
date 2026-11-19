import * as THREE from 'three';

/** Seeded random number generator (mulberry32), so a wood looks the same every time it is drawn. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, used to seed the generator from a colour. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const SIZE = 256;

/** Procedural wood: streaks along U for long grain, growth rings and pores for end grain. */
export function makeWoodTexture(color: string, kind: 'long' | 'end'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rand = rng(hashString(color + kind));
  // Work in the hex colour's own sRGB values. THREE.Color converts to linear, and painting
  // those numbers on a canvas turns mid-tone woods like teak nearly black.
  const base = { r: 0, g: 0, b: 0 };
  new THREE.Color(color).getRGB(base, THREE.SRGBColorSpace);
  const lum = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b;
  /** The base colour scaled by k, as a CSS rgba string at the given opacity. */
  const shade = (k: number, alpha: number) => {
    /** One colour channel scaled, clamped and converted to 0-255. */
    const ch = (v: number) => Math.round(Math.min(1, v * k) * 255);
    return `rgba(${ch(base.r)},${ch(base.g)},${ch(base.b)},${alpha})`;
  };
  ctx.fillStyle = shade(kind === 'end' ? 0.94 : 1, 1);
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Dark woods need lighter streaks to show any figure at all.
  const light = lum < 0.3 ? 1.5 : 1.12;

  if (kind === 'long') {
    for (let i = 0; i < 150; i++) {
      const y = rand() * SIZE, amp = rand() * 2.2, waves = 1 + Math.floor(rand() * 2), phase = rand() * 6.28;
      ctx.strokeStyle = rand() < 0.6 ? shade(0.72, 0.05 + rand() * 0.13) : shade(light, 0.05 + rand() * 0.1);
      ctx.lineWidth = 0.5 + rand() * 2.2;
      // Draw three copies so the streak wraps cleanly at the top and bottom edges.
      for (const dy of [-SIZE, 0, SIZE]) {
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += 8) {
          const yy = y + dy + amp * Math.sin((x / SIZE) * 6.2832 * waves + phase);
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
  } else {
    for (let y = 0; y < SIZE; y += 5 + rand() * 6) {
      const amp = 1 + rand() * 3, phase = rand() * 6.28;
      ctx.strokeStyle = shade(0.7, 0.06 + rand() * 0.1);
      ctx.lineWidth = 0.8 + rand() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 8) {
        const yy = y + amp * Math.sin((x / SIZE) * 6.2832 + phase);
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rand() < 0.75 ? shade(0.55, 0.12 + rand() * 0.14) : shade(light, 0.12);
      ctx.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand(), 1 + rand());
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
