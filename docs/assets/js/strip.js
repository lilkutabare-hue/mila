// Strip: photos packed into columns that fill the whole viewport, infinite horizontal scroll.
// One transform per frame on the track; nodes keep static left/top and only hop by loopW when they wrap.
import { pickTier, preloadImage, REDUCED } from './media.js?v=79fcd37b';

export function createStrip({ items, stage, loop = true, loopIfWide = false, layout = 'scatter', swipeDown = false, drift = 0, depth = 0, maxTier = 'full', onOpen }) {
  let looping = loop;                      // a band loops too once it is wider than the screen
  const track = stage.querySelector('.track');
  let live = items.slice(), nodes = [], base = new Map();
  let vw = 0, vh = 0, loopW = 1, pad = 0, pos = 0, target = 0, last = 0, offsetX = 0;
  let raf = 0, active = false, suppressClick = false;
  let inVel = 0, lastInput = 0;            // smoothed input speed (px/s) for the glide after the wheel stops
  let dragY = 0, dragYTarget = 0;          // vertical pull of the whole track (swipe-down to close)
  let firstScreen = true;                  // the first frames fetched get fetchpriority=high
  let pending = 0;                         // images in flight; the rest of the strip preloads in the background, a few at a time
  let lastTouch = performance.now();      // any input; the drift ramps up again from zero after it
  const driftDir = Math.random() < 0.5 ? -1 : 1;   // this visit's direction

  // ---------- nodes ----------
  function makeNode(item, clone = false) {
    const el = document.createElement('button');
    el.className = 'pic'; el.type = 'button';
    if (clone) { el.setAttribute('aria-hidden', 'true'); el.tabIndex = -1; } else el.setAttribute('aria-label', item.projectObj.title);
    const node = { item, el, media: null, loaded: false, w: 0, h: 0, x: 0, top: 0, k: null, visible: false, clone, playing: false };
    el.addEventListener('tap', () => onOpen?.(item, node));
    return node;
  }
  const rnd = item => (item._r ??= { a: Math.random(), b: Math.random(), c: Math.random(), d: Math.random() });

  // ---------- layout ----------
  function place(node, x, top, w, h) {
    node.x = x; node.top = Math.round(top); node.w = Math.round(w); node.h = Math.round(h);
    node.el.style.width = node.w + 'px'; node.el.style.height = node.h + 'px'; node.el.style.top = node.top + 'px'; node.el.style.left = node.x + 'px';
    node.k = null;
  }
  // band: one glued horizontal row of a shoot, sitting a little above the centre, never full-height
  function layoutBand(list) {
    const phone = vw < 700;
    const bandH = Math.round(vh * (phone ? 0.46 : 0.52));
    const top = Math.round(vh * 0.48 - bandH / 2);
    let x = 0;
    for (const node of list) {
      // each frame takes 72–100% of the band height, centred on the band line, so neighbours differ in size
      const ar = node.item.w / node.item.h; let h = bandH * (0.72 + rnd(node.item).a * 0.28), w = h * ar;
      if (w > vw * 0.92) { w = vw * 0.92; h = w / ar; }
      place(node, x, top + (bandH - h) / 2, w, h); x += node.w;
    }
    return x;
  }
  // phone: frames glued edge to edge in one row, each a random height, centred on the band line
  function layoutTight(list) {
    // one axis across the screen; every frame hangs on it with a small offset, so neighbours always overlap by well over half
    const topSafe = 24, bottomSafe = Math.max(vh * 0.1, 96);
    const free = vh - topSafe - bottomSafe;
    const axis = topSafe + free * (0.44 + rnd(list[0]?.item || {}).c * 0.12);   // 44–56% of the free band, chosen per visit
    let x = 0;
    for (const node of list) {
      const r = rnd(node.item), ar = node.item.w / node.item.h;
      let h = vh * (0.19 + r.a * 0.06), w = h * ar;           // about a fifth to a quarter of the screen height
      if (w > vw * 0.96) { w = vw * 0.96; h = w / ar; }
      const top = axis - h / 2 + (r.b - 0.5) * 0.4 * h;      // centre within ±20% of its own height from the axis
      place(node, x, top, w, h); x += node.w;
      node.depth = 0;
    }
    return x;
  }
  function layoutScatter(list) {
    const phone = vw < 700, tall = vh > vw;
    if (phone) return layoutTight(list);
    const maxW = vw * (phone ? 0.92 : 0.46), minH = vh * (phone ? 0.16 : 0.14);
    const topSafe = phone ? 28 : 36, bottomSafe = Math.max(vh * 0.1, phone ? 104 : 116);   // nav + seal band below: photos never touch it
    let x = vw * 0.04, i = 0;
    while (i < list.length) {
      const lead = rnd(list[i].item);
      const want = tall ? (lead.a < 0.3 ? 2 : lead.a < 0.75 ? 3 : 4) : (lead.a < 0.3 ? 1 : lead.a < 0.8 ? 2 : 3);
      // every column gets its own vertical band: a different top edge and a different height
      const r = lead;
      const free = vh - topSafe - bottomSafe;
      const bandH = free * (0.55 + r.b * 0.45);          // 55–100% of the free height: columns differ in height and position
      const bandTop = topSafe + r.c * Math.max(0, free - bandH);
      const vgap = Math.round(vh * (0.015 + r.d * 0.03));
      const col = list.slice(i, i + Math.min(want, list.length - i));
      const weights = col.map(x => 0.5 + rnd(x.item).b * 1.1), sum = weights.reduce((a, b) => a + b, 0);
      const avail = bandH - vgap * (col.length - 1);
      const sizes = col.map((x, j) => {
        const ar = x.item.w / x.item.h; let h = Math.max(minH, avail * weights[j] / sum), w = h * ar;
        if (w > maxW) { w = maxW; h = w / ar; }
        return { w, h };
      });
      let used = sizes.reduce((a, sz) => a + sz.h, 0) + vgap * (col.length - 1);
      if (used > bandH) { const k = (bandH - vgap * (col.length - 1)) / (used - vgap * (col.length - 1)); for (const sz of sizes) { sz.w *= k; sz.h *= k; } used = bandH; }
      const colW = Math.max(...sizes.map(s => s.w));
      let y = bandTop + rnd(col[col.length - 1].item).c * Math.max(0, bandH - used);
      const depthK = r.d < 0.34 ? -1 : r.d < 0.67 ? 0 : 1;
      col.forEach((n, j) => {
        const s = sizes[j], dx = rnd(n.item).d * (colW - s.w);
        place(n, Math.round(x + dx), y, s.w, s.h); n.depth = depthK;
        y += s.h + vgap;
      });
      x += colW + vw * (phone ? 0.04 : 0.02) + rnd(col[0].item).a * vw * (phone ? 0.1 : 0.06);
      i += col.length;
    }
    return x;
  }

  function build(keepItem) {
    vw = stage.clientWidth || innerWidth; vh = stage.clientHeight || innerHeight;
    for (const n of nodes) if (n.clone) n.el.remove();
    for (const [item, n] of base) if (!live.includes(item)) { n.el.remove(); base.delete(item); }
    nodes = [];
    for (const item of live) {
      let node = base.get(item);
      if (!node) { node = makeNode(item); base.set(item, node); track.appendChild(node.el); }
      nodes.push(node);
    }
    loopW = Math.max(1, Math.round(layout === 'scatter' ? layoutScatter(nodes) : layoutBand(nodes)));
    pad = Math.max(...nodes.map(n => n.w), 1);
    looping = loop || (loopIfWide && loopW > vw);
    if (looping) {
      const need = 1.5 * (vw + 2 * pad); let reps = 1; const bn = nodes.slice();
      while (loopW * reps < need && bn.length) {
        for (const s of bn) { const c = makeNode(s.item, true); place(c, s.x + loopW * reps, s.top, s.w, s.h); track.appendChild(c.el); nodes.push(c); }
        reps++;
      }
      loopW *= reps;
    }
    for (const n of nodes) { n.visible = false; n.el.classList.add('off'); n.k = null; }
    // content narrower than the screen just sits in the middle and does not move
    offsetX = !looping && loopW < vw ? Math.round((vw - loopW) / 2) : 0;
    stage.classList.toggle('static', !looping && loopW <= vw);
    if (keepItem && base.has(keepItem)) pos = target = base.get(keepItem).x - vw * 0.04;
    else pos = target = 0;
    if (!looping) pos = target = Math.max(0, Math.min(maxPos(), pos));
  }
  const maxPos = () => Math.max(0, loopW - vw);

  // ---------- media ----------
  function upgrade(node) { // swap in the 2560px version once the frame is actually near the screen
    node.needFull = false; const img = node.media, src = node.item.full.src;
    preloadImage(src).then(() => { if (node.el.isConnected && img === node.media) img.src = src; }).catch(() => {});
  }
  function load(node, background = false) {
    if (node.loaded) return; node.loaded = true;
    const { item } = node;
    if (item.type === 'photo') {
      const img = new Image(); img.decoding = 'async'; img.alt = '';
      let settled = false; const settle = () => { if (!settled) { settled = true; pending--; } };
      pending++;
      img.onload = () => { settle(); node.el.classList.add('loaded'); };
      img.onerror = () => { settle(); fail(node); };
      let tier = pickTier(item, node.w, node.h);
      if (tier === 'full' && maxTier !== 'full') tier = 'rail';     // the collage never needs 2560px frames
      if (!background && (node.visible || firstScreen)) img.fetchPriority = 'high';
      if (background) img.fetchPriority = 'low';
      img.src = (tier === 'full' ? item.rail : item[tier]).src; node.el.appendChild(img); node.media = img;
      if (tier === 'full') { if (background) node.needFull = true; else upgrade(node); }
    } else {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'none';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      const small = item.small && pickTier(item, node.w, node.h) === 'small';
      v.poster = item.poster.rail; v.src = (small ? item.small : item.rail).src;
      v.addEventListener('error', () => fail(node));
      node.el.classList.add('loaded'); node.el.appendChild(v); node.media = v;
    }
  }
  function fail(node) {
    console.warn('media failed, removed:', node.item.id);
    live = live.filter(i => i !== node.item); base.delete(node.item); node.el.remove(); build(null);
  }
  function playVideo(node, frac) {
    const m = node.media; if (!m || m.tagName !== 'VIDEO') return;
    const should = frac >= 0.3 && active;
    if (should && !node.playing) { node.playing = true; m.play().catch(() => {}); }
    else if (!should && node.playing) { node.playing = false; m.pause(); }
  }

  // ---------- frame ----------
  let sizeCheck = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (firstScreen && now - last > 0 && sizeCheck > 30) firstScreen = false;
    if (++sizeCheck % 20 === 0 && !ptr) { // every ~third of a second: did the viewport change under us?
      const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
      if (Math.abs(w - vw) > 1 || Math.abs(h - vh) > vh * 0.15) build(nodes.find(n => n.visible)?.item || null);
    }
    tick(now);
  }
  function tick(now) {
    const dt = Math.min(50, now - last || 16.67); last = now;
    // glide: once the wheel goes quiet, the smoothed input speed keeps pushing the target and decays
    if (inVel && now - lastInput > 40) { target += inVel * dt / 1000; inVel *= Math.pow(vw < 700 ? 0.00002 : 0.0009, dt / 1000); if (Math.abs(inVel) < 8) inVel = 0; }
    if (drift && !ptr && !REDUCED.matches) {
      // after arrival the drift eases from 0 to its peak over 35 s; after any touch it waits 3 s, then eases in again
      const t = Math.max(0, Math.min(1, (now - lastTouch - 3000) / 35000)), ease = t * t * (3 - 2 * t);
      target += driftDir * drift * ease * dt / 1000;
    }
    if (!looping) target = Math.max(0, Math.min(maxPos(), target));
    const phone = vw < 700;
    const lerp = REDUCED.matches ? 0.35 : phone ? 0.3 : 0.085;
    pos += (target - pos) * (1 - Math.pow(1 - lerp, dt / 16.67));
    if (Math.abs(target - pos) < 0.05) pos = target;
    dragY += (dragYTarget - dragY) * (1 - Math.pow(0.8, dt / 16.67));
    if (Math.abs(dragY - dragYTarget) < 0.1) dragY = dragYTarget;
    track.style.transform = `translate3d(${(offsetX - pos).toFixed(2)}px,${dragY.toFixed(1)}px,0)`;
    const speed = Math.abs(target - pos);        // px still to travel: the faster the flick, the further we preload
    const ahead = vw * 1.25 + Math.min(vw * 4, speed * 1.5);
    const lo = pos - pad, hi = pos + vw + pad;  // world window that may be on screen
    let bgNode = null, bgDist = Infinity;       // nearest frame that is not loaded yet
    for (const node of nodes) {
      let left = node.x;
      if (looping) { // choose the copy of this node whose world x lies in [pos - pad, pos - pad + loopW)
        const k = Math.ceil((pos - pad - node.x) / loopW);
        if (k !== node.k) { node.k = k; node.el.style.left = (node.x + k * loopW) + 'px'; }
        left = node.x + k * loopW;
      }
      const sx = left - pos + offsetX;
      const on = sx < vw + pad && sx + node.w > -pad;
      const lx = looping && sx > vw * 2 ? sx - loopW : sx;
      const nearView = lx > -ahead && lx < ahead;
      if (!node.loaded && nearView) load(node);
      else if (node.needFull && nearView) upgrade(node);
      else if (!node.loaded) { const d = Math.abs(lx + node.w / 2 - vw / 2); if (d < bgDist) { bgDist = d; bgNode = node; } }
      if (on) {
        if (!node.visible) { node.visible = true; node.el.classList.remove('off'); node.el.style.willChange = 'transform'; }
        if (depth && node.depth) node.el.style.transform = `translate3d(${((sx + node.w / 2 - vw / 2) * node.depth * depth).toFixed(1)}px,0,0)`;
        if (node.item.type === 'motion') playVideo(node, (Math.min(vw, sx + node.w) - Math.max(0, sx)) / node.w);
      } else if (node.visible) { node.visible = false; node.el.classList.add('off'); node.el.style.willChange = ''; if (node.item.type === 'motion') playVideo(node, 0); }
    }
    preloadNext(bgNode);
  }

  // background preload: after the first screen has settled, keep up to three images in flight, nearest first
  function preloadNext(node) { if (node && !firstScreen && pending < 3) load(node, true); }

  // ---------- input ----------
  let wheelPrev = 0;
  addEventListener('wheel', e => {
    if (!active || !stage.contains(e.target)) return;
    e.preventDefault();
    let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= vw;
    d = Math.max(-120, Math.min(120, d));
    target += d;
    const now = e.timeStamp, gap = Math.max(8, now - wheelPrev); wheelPrev = now; lastInput = now; lastTouch = performance.now();
    const v = d / gap * 1000;                     // px/s of this event
    inVel = Math.abs(v) > Math.abs(inVel) ? v * 0.6 : inVel * 0.7 + v * 0.3 * 0.6;
  }, { passive: false });
  let ptr = null;
  stage.addEventListener('pointerdown', e => {
    if (!active || e.button !== 0) return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, axis: e.pointerType === 'mouse' && !swipeDown ? 'x' : null, samples: [], moved: false, hit: e.target.closest('.pic') };
    try { stage.setPointerCapture(e.pointerId); } catch {} target = pos; inVel = 0; lastTouch = performance.now();
  });
  stage.addEventListener('pointermove', e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!ptr.axis) { const tx = Math.abs(e.clientX - ptr.sx), ty = Math.abs(e.clientY - ptr.sy); if (Math.max(tx, ty) < 6) return; ptr.axis = tx >= ty ? 'x' : 'y'; }
    if (!ptr.moved && Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) > 6) { ptr.moved = true; stage.classList.add('dragging'); }
    if (ptr.axis === 'y' && swipeDown) { dragY = dragYTarget = Math.max(0, e.clientY - ptr.sy); }
    else target -= ptr.axis === 'x' ? dx : dy;
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.samples.push({ t: e.timeStamp, p: target }); ptr.samples = ptr.samples.filter(s => e.timeStamp - s.t <= 100);
  });
  const endPtr = e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const s = ptr.samples;
    if (s.length >= 2) { const a = s[0], b = s[s.length - 1]; const v = (b.p - a.p) / Math.max(1, b.t - a.t) * 1000; if (Math.abs(v) > 50) { inVel = v * (vw < 700 ? 0.45 : 0.9); lastInput = 0; } }
    const { moved, hit, axis, sy } = ptr; ptr = null; stage.classList.remove('dragging'); lastTouch = performance.now();
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (swipeDown && axis === 'y') {
      if (e.type === 'pointerup' && e.clientY - sy > 90) { stage.dispatchEvent(new CustomEvent('swipedown')); setTimeout(() => { dragY = dragYTarget = 0; }, 400); }
      else dragYTarget = 0;
      return;
    }
    if (!moved && e.type === 'pointerup') { if (hit) hit.dispatchEvent(new CustomEvent('tap')); else stage.dispatchEvent(new CustomEvent('tapout')); }
  };
  stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
  stage.addEventListener('click', e => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); return; }
    const b = e.target.closest('.pic'); if (b) { e.preventDefault(); b.dispatchEvent(new CustomEvent('tap')); }
  }, true);
  addEventListener('keydown', e => {
    if (!active || e.defaultPrevented || e.target.matches('input, textarea')) return;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': target += vw * 0.8; break;
      case 'ArrowLeft': case 'PageUp': target -= vw * 0.8; break;
      case 'Home': target = 0; break;
      default: return;
    }
    lastTouch = performance.now(); e.preventDefault();
  });
  let rt = 0;
  const relayout = () => {
    if (!active) return; clearTimeout(rt);
    rt = setTimeout(() => {
      const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
      if (Math.abs(w - vw) > 1 || Math.abs(h - vh) > vh * 0.15) build(nodes.find(n => n.visible)?.item || null);
    }, 150);
  };
  addEventListener('resize', relayout);
  addEventListener('orientationchange', relayout);
  visualViewport?.addEventListener('resize', relayout);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (active) run(); });
  function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  return {
    start() { if (active) return; build(null); active = true; run(); },
    pause() { active = false; stop(); for (const n of nodes) playVideo(n, 0); },
    resume() {
      if (active) return; active = true; lastTouch = performance.now();
      const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
      if (!nodes.length) build(null); else if (w !== vw || h !== vh) build(nodes.find(n => n.visible)?.item || null);
      run();
    },
    setItems(list) { live = list.slice(); for (const n of nodes) n.el.remove(); for (const [, n] of base) n.el.remove(); track.replaceChildren(); base = new Map(); nodes = []; if (active) build(null); },
    get active() { return active; },
    nudge(d) { target += d; },
    stats: () => ({ pos, target, loopW, pad, nodes: nodes.length, vw, vh, inVel }),
    debugNodes: () => nodes,
  };
}
