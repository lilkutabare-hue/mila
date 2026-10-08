// Wardrobe: every work, by project, justified rows, lazy HQ loading. With a role picked, only that side of the work.
import { pickTier, esc, REDUCED } from './media.js?v=a1b9ccd2';

export function createWardrobe({ el, projects, role = null, onOpen }) {
  const scroll = el.querySelector('.scroll');
  const sectionsEl = el.querySelector('#sections');
  let open = false, builtWidth = 0, dirty = false, swapId = 0;
  const W_OUT = [{ opacity: 0, filter: 'blur(8px)', transform: 'translateY(-12px)' }];
  const W_IN = [{ opacity: 0, filter: 'blur(10px)', transform: 'translateY(-12px)' }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }];
  const itemsOf = p => role ? p.itemObjs.filter(i => i.role === role) : p.itemObjs;
  const shown = () => projects.filter(p => itemsOf(p).length);
  const tiles = new Map(); // item.id -> {el, item, w, h, tier, loaded}

  // ---- sections (built once, rows laid out per width)
  const sections = new Map();
  for (const p of projects) {
    const sec = document.createElement('section');
    sec.className = 'section'; sec.id = 'w-' + p.slug; sec.dataset.cat = p.category;
    sec.innerHTML = `<h2 class="section-head"><span class="t">${esc(p.title)}</span>${p.year ? `<span class="yr">${esc(p.year)}</span>` : ''}</h2><div class="rows"></div>`;
    sections.set(p.slug, sec);
    for (const item of p.itemObjs) {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'tile'; t.dataset.id = item.id;
      t.setAttribute('aria-label', `${p.title} — ${item.type === 'motion' ? 'video' : 'photo'}`);
      t.addEventListener('click', () => onOpen(item));
      tiles.set(item.id, { el: t, item, w: 0, h: 0, tier: null, loaded: false });
    }
  }
  function render() { dirty = false; sectionsEl.replaceChildren(...shown().map(p => sections.get(p.slug))); layout(true); }

  function layout(force) {
    const W = sectionsEl.clientWidth; if (!W || (!force && W === builtWidth)) return;
    builtWidth = W;
    const phone = innerWidth < 900, targetH = phone ? 180 : 320, gap = 8;
    for (const p of shown()) {
      const rowsEl = sections.get(p.slug).querySelector('.rows');
      const rows = []; let row = [], sumAR = 0;
      for (const item of itemsOf(p)) {
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
      if (!open) { open = true; if (!sectionsEl.childElementCount || dirty) render(); else layout(false); }
      if (slug && sections.has(slug)) {
        layout(false); sections.get(slug).scrollIntoView({ block: 'start' });
      }
      else layout(false);
    },
    close() { if (!open) return; open = false; for (const t of tiles.values()) t.el.querySelector('video')?.pause(); },
    currentList() { return shown().flatMap(itemsOf); },
    setRole(r) {
      if (r === role) return; role = r;
      if (!open) { dirty = true; return; }   // hidden: widths read 0, lay out on the next open
      // the shoots on screen lift away blurred, one after another; the new ones settle in from the same height
      const id = ++swapId;
      const seen = () => [...sectionsEl.children].filter(sec => { const b = sec.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
      const refill = () => { render(); scroll.scrollTop = 0; };
      if (REDUCED.matches) { refill(); return; }
      Promise.all(seen().map((sec, i) => sec.animate(W_OUT, { duration: 260, delay: i * 50, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }).finished.catch(() => {}))).then(() => {
        if (id !== swapId) return;
        for (const sec of sections.values()) sec.getAnimations().forEach(a => a.cancel());
        refill();
        seen().forEach((sec, i) => sec.animate(W_IN, { duration: 560, delay: i * 70, easing: 'cubic-bezier(.2,.7,.1,1)', fill: 'backwards' }));
      });
    },
    relayout: () => layout(true),
  };
}
