// Tiny stable entry: reads the build version, then loads the stylesheet and the app with that version in the URL,
// so every publish busts browser and CDN caches without touching the Tilda block.
(async () => {
  // quiet preloader, painted before anything is fetched: paper and the name, nothing else
  if (!document.getElementById('mh-loader')) {
    const l = document.createElement('div'); l.id = 'mh-loader';
    l.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#F2F0EB;display:flex;align-items:center;justify-content:center;font:11px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.02em;color:#141414;text-transform:lowercase;transition:opacity .5s ease';
    const t = document.createElement('span'); t.textContent = window.MH_NAME || 'mila harys'; l.appendChild(t);
    (document.body || document.documentElement).appendChild(l);
    try { t.animate([{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' }); } catch {}
    setTimeout(() => window.MH_HIDE_LOADER?.(), 9000);   // never trap the visitor behind it
  }
  window.MH_HIDE_LOADER = () => { const l = document.getElementById('mh-loader'); if (!l || l.dataset.out) return; l.dataset.out = '1'; l.style.opacity = '0'; l.style.pointerEvents = 'none'; setTimeout(() => l.remove(), 600); };
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
