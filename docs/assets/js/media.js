// Media helpers: tier selection, preloading, formatting.
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
export const FINE = matchMedia('(hover: hover) and (pointer: fine)');

// A tile whose physical height fits in the rail tier gets rail; anything bigger gets full.
export function pickTier(item, cssW, cssH) {
  const need = cssH * (devicePixelRatio || 1);
  if (item.small && need <= item.small.h) return 'small';
  return need <= item.rail.h ? 'rail' : 'full';
}
export function photoSrc(item, tier) { return item.type === 'photo' ? item[tier].src : item.poster[tier]; }

const cache = new Map();
export function preloadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((res, rej) => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => im.decode().then(() => res(im), () => res(im));
    im.onerror = () => { cache.delete(src); rej(new Error('image failed: ' + src)); };
    im.src = src;
  });
  cache.set(src, p); return p;
}
export function fmtTime(s) { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function pad3(n) { return String(n).padStart(3, '0'); }
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
