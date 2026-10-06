// Tiny stable entry: reads the build version, then loads the stylesheet and the app with that version in the URL,
// so every publish busts browser and CDN caches without touching the Tilda block.
(async () => {
  const base = (window.MH_BASE || new URL('../../', import.meta.url).href).replace(/\/?$/, '/');
  let v = Date.now().toString(36);
  try { const r = await fetch(base + 'data/version.txt', { cache: 'no-store' }); if (r.ok) v = (await r.text()).trim() || v; } catch {}
  window.MH_BASE = base; window.MH_V = v;
  if (!document.querySelector('link[data-mh-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'assets/style.css?v=' + v; l.dataset.mhCss = '1';
    const ready = new Promise(res => { l.onload = l.onerror = res; setTimeout(res, 1500); });
    document.head.appendChild(l); await ready;
  }
  await import(base + 'assets/js/main.js?v=' + v);
})();
