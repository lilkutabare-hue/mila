// Wardrobe: every work, by project, justified rows, lazy HQ loading.
import { pickTier, esc, fmtTime } from './media.js';

export function createWardrobe({ el, manifest, projects, site, onOpen }) {
  const scroll = el.querySelector('.scroll');
  const filtersEl = el.querySelector('#filters'), tocEl = el.querySelector('#toc'), sectionsEl = el.querySelector('#sections');
  let filter = 'all', open = false, builtWidth = 0;
  const tiles = new Map(); // item.id -> {el, item, w, h, tier, loaded}

  // ---- filters
  const cats = Object.keys(site.categories || {}).filter(c => manifest.projects.some(p => p.category === c));
  for (const p of manifest.projects) if (!cats.includes(p.category)) cats.push(p.category);
  const countOf = c => manifest.items.filter(i => c === 'all' || i.projectObj.category === c).length;
  filtersEl.innerHTML = [['all', 'all'], ...cats.map(c => [c, site.categories?.[c] ?? c])]
    .map(([k, label]) => `<button type="button" data-f="${esc(k)}" aria-pressed="${k === 'all'}">${esc(label)}<span class="k">${countOf(k)}</span></button>`).join('');
  filtersEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    filter = b.dataset.f;
    filtersEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    render(); scroll.scrollTo({ top: 0 });
  });

  // ---- sections (built once, rows laid out per width)
  const sections = new Map();
  for (const p of projects) {
    const sec = document.createElement('section');
    sec.className = 'section'; sec.id = 'w-' + p.slug; sec.dataset.cat = p.category;
    sec.innerHTML = `<h2 class="section-head"><span class="t">${esc(p.title)}</span><span class="cat">${esc(p.categoryLabel)}</span><span class="cnt">${p.count}</span>${p.credits ? `<span class="cr">${esc(p.credits)}</span>` : ''}</h2><div class="rows"></div>`;
    sections.set(p.slug, sec);
    for (const item of p.itemObjs) {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'tile'; t.dataset.id = item.id;
      t.setAttribute('aria-label', `${p.title} — ${item.type === 'motion' ? 'video' : 'photo'}`);
      if (item.type === 'motion') t.innerHTML = `<span class="m">motion · ${fmtTime(item.duration)}</span>`;
      t.addEventListener('click', () => onOpen(item));
      tiles.set(item.id, { el: t, item, w: 0, h: 0, tier: null, loaded: false });
    }
  }
  sectionsEl.addEventListener('click', () => {});

  function visibleProjects() { return projects.filter(p => filter === 'all' || p.category === filter); }
  function render() {
    const vis = visibleProjects();
    tocEl.innerHTML = vis.map(p => `<a href="#w-${esc(p.slug)}" data-slug="${esc(p.slug)}">${esc(p.title)}</a>`).join('<span class="dot"> · </span>');
    sectionsEl.replaceChildren(...vis.map(p => sections.get(p.slug)));
    if (!vis.length) sectionsEl.innerHTML = '<p class="empty">nothing here</p>';
    layout(true);
  }
  tocEl.addEventListener('click', e => {
    const a = e.target.closest('a[data-slug]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    sections.get(a.dataset.slug)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  function layout(force) {
    const W = sectionsEl.clientWidth; if (!W || (!force && W === builtWidth)) return;
    builtWidth = W;
    const headH = el.querySelector('.head').offsetHeight;
    for (const sec of sections.values()) sec.style.scrollMarginTop = (headH + 8) + 'px';
    const phone = innerWidth < 900, targetH = phone ? 180 : 320, gap = 8;
    for (const p of visibleProjects()) {
      const rowsEl = sections.get(p.slug).querySelector('.rows');
      const rows = []; let row = [], sumAR = 0;
      for (const item of p.itemObjs) {
        const ar = item.w / item.h; row.push({ item, ar }); sumAR += ar;
        if (sumAR * targetH + gap * (row.length - 1) >= W) { rows.push({ row, h: (W - gap * (row.length - 1)) / sumAR }); row = []; sumAR = 0; }
      }
      if (row.length) { const h = Math.min(targetH, (W - gap * (row.length - 1)) / sumAR); rows.push({ row, h, last: true }); }
      const frag = document.createDocumentFragment();
      for (const r of rows) {
        const rowEl = document.createElement('div'); rowEl.className = 'row';
        const h = Math.round(r.h); let used = 0;
        r.row.forEach((c, i) => {
          const t = tiles.get(c.item.id);
          let w = Math.round(c.ar * r.h);
          if (!r.last && i === r.row.length - 1) w = W - gap * (r.row.length - 1) - used;
          used += w;
          t.w = w; t.h = h; t.el.style.width = w + 'px'; t.el.style.height = h + 'px';
          rowEl.appendChild(t.el);
          if (t.loaded) upgrade(t);
        });
        frag.appendChild(rowEl);
      }
      rowsEl.replaceChildren(frag);
    }
    observeAll();
  }

  // ---- lazy loading
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { load(tiles.get(e.target.dataset.id)); io.unobserve(e.target); } }, { root: scroll, rootMargin: '600px 0px' });
  const vio = new IntersectionObserver(es => { for (const e of es) { const v = e.target.querySelector('video'); if (!v) continue; if (e.intersectionRatio >= 0.5) v.play().catch(() => {}); else v.pause(); } }, { root: scroll, threshold: [0, 0.5, 1] });
  function observeAll() { for (const t of tiles.values()) if (!t.loaded && t.el.isConnected) io.observe(t.el); }
  function load(t) {
    if (t.loaded) return; t.loaded = true;
    const { item } = t;
    if (item.type === 'photo') {
      t.tier = pickTier(item, t.w, t.h);
      const img = new Image(); img.decoding = 'async'; img.alt = '';
      img.onload = () => t.el.classList.add('loaded');
      img.onerror = () => { console.warn('tile failed:', item.id); t.el.remove(); tiles.delete(item.id); item.projectObj.itemObjs = item.projectObj.itemObjs.filter(i => i !== item); layout(true); };
      img.src = item[t.tier].src; t.el.prepend(img);
    } else {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'none';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      const pt = pickTier(item, t.w, t.h); v.poster = item.poster[pt === 'full' ? 'full' : 'rail']; v.src = (pt === 'small' && item.small ? item.small : item.rail).src;
      t.el.classList.add('loaded'); t.el.prepend(v); vio.observe(t.el);
    }
  }
  const RANK = { small: 0, rail: 1, full: 2 };
  function upgrade(t) {
    if (t.item.type !== 'photo' || t.tier === 'full') return;
    const want = pickTier(t.item, t.w, t.h);
    if (RANK[want] > RANK[t.tier]) { t.tier = want; const img = t.el.querySelector('img'); if (img) img.src = t.item[want].src; }
  }

  let rt = 0;
  addEventListener('resize', () => { if (!open) return; clearTimeout(rt); rt = setTimeout(() => layout(false), 150); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); history.back(); } });

  return {
    get isOpen() { return open; },
    open(slug) {
      if (!open) { open = true; if (!sectionsEl.childElementCount) render(); else layout(false); }
      if (slug && sections.has(slug)) {
        const p = projects.find(p => p.slug === slug);
        if (p && filter !== 'all' && p.category !== filter) { filter = 'all'; filtersEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === 'all')); render(); }
        layout(false); sections.get(slug).scrollIntoView({ block: 'start' });
      }
      else layout(false);
    },
    close() { if (!open) return; open = false; for (const t of tiles.values()) t.el.querySelector('video')?.pause(); },
    currentList() { return visibleProjects().flatMap(p => p.itemObjs); },
    relayout: () => layout(true),
  };
}
