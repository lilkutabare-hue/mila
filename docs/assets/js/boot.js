// Tiny stable entry: reads the build version, then loads the stylesheet and the app with that version in the URL,
// so every publish busts browser and CDN caches without touching the Tilda block.
(async () => {
  // quiet preloader, painted before anything is fetched: paper and the name, nothing else
  if (!document.getElementById('mh-loader')) {
    const l = document.createElement('div'); l.id = 'mh-loader';
    // the stylesheet is not here yet, so the motion tokens (360ms, the two curves, the glint band) are repeated inline
    l.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#FFFFFF;display:flex;align-items:center;justify-content:center;font:11px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.02em;color:#000000;text-transform:lowercase;transition:opacity 360ms cubic-bezier(.2,.7,.1,1)';
    const t = document.createElement('span'); t.textContent = window.MH_NAME || 'mila harys'; l.appendChild(t);
    t.style.cssText = 'background:linear-gradient(100deg,#000000 0 44%,#8C8C8C 50%,#000000 56% 100%) 100% 0/300% 100% no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent';
    (document.body || document.documentElement).appendChild(l);
    // one band of light through the name, then stillness
    try { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) t.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0 0' }], { duration: 1200, delay: 350, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }); } catch {}
    setTimeout(() => window.MH_HIDE_LOADER?.(), 9000);   // never trap the visitor behind it
  }
  window.MH_HIDE_LOADER = () => { const l = document.getElementById('mh-loader'); if (!l || l.dataset.out) return; l.dataset.out = '1'; l.style.opacity = '0'; l.style.pointerEvents = 'none'; setTimeout(() => l.remove(), 400); };
  const base = (window.MH_BASE || new URL('../../', import.meta.url).href).replace(/\/?$/, '/');
  let v = Date.now().toString(36);
  try { const r = await fetch(base + 'data/version.txt', { cache: 'no-store' }); if (r.ok) v = (await r.text()).trim() || v; } catch {}
  window.MH_BASE = base; window.MH_V = v;
  if (!document.querySelector('link[data-mh-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'assets/style.css?v=' + v; l.dataset.mhCss = '1';
    const ready = new Promise(res => { l.onload = l.onerror = res; setTimeout(res, 1500); });
    document.head.appendChild(l); await ready;
  }
  try { await import(base + 'assets/js/main.js?v=' + v); } catch (e) { window.MH_HIDE_LOADER(); throw e; }
})();
