// Full-screen viewer: a look taken off the hanger.
import { pickTier, preloadImage, fmtTime, pad3, esc, REDUCED, E_OUT, T1, T2 } from './media.js?v=21fb2bf1';

export function createViewer({ el, setTaken, centerRail, isOnRail, onNavigate, onClose }) {
  const settle = (anim, ms) => Promise.race([anim.finished.catch(() => {}), new Promise(r => setTimeout(r, ms))]);
  const stage = el.querySelector('#v-stage'), bottom = el.querySelector('#v-bottom'), countEl = el.querySelector('#v-count');
  const closeBtn = el.querySelector('#v-close'), prevBtn = el.querySelector('#v-prev'), nextBtn = el.querySelector('#v-next');
  let open = false, list = [], cur = null, source = 'rail', box = null, video = null, lastFocus = null, takenId = null, closing = false;
  const idx = () => list.findIndex(i => i.id === cur?.id);
  const phone = () => innerWidth < 900;

  function fitRect(item) {
    const r = stage.getBoundingClientRect(), cs = getComputedStyle(stage);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const aw = Math.max(40, r.width - pl - pr), ah = Math.max(40, r.height - pt - pb), ar = item.w / item.h;
    let w = aw, h = w / ar; if (h > ah) { h = ah; w = h * ar; }
    return { w: Math.round(w), h: Math.round(h), left: r.left + pl + (aw - w) / 2, top: r.top + pt + (ah - h) / 2 };
  }
  function controls(v, item) {
    const c = document.createElement('div'); c.className = 'v-ctl';
    c.innerHTML = `<button type="button" class="pp">play</button><div class="bar" role="slider" aria-label="progress"><i></i></div><span class="time">0:00 / ${fmtTime(item.duration)}</span><button type="button" class="snd">sound off</button>`;
    const pp = c.querySelector('.pp'), bar = c.querySelector('.bar'), fill = c.querySelector('i'), time = c.querySelector('.time'), snd = c.querySelector('.snd');
    const toggle = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
    pp.addEventListener('click', toggle);
    v.addEventListener('click', toggle);
    v.addEventListener('play', () => { pp.textContent = 'pause'; });
    v.addEventListener('pause', () => { pp.textContent = 'play'; });
    v.addEventListener('timeupdate', () => { const d = v.duration || item.duration || 1; fill.style.width = (v.currentTime / d * 100) + '%'; time.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(d)}`; });
    const seek = e => { const r = bar.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); v.currentTime = f * (v.duration || item.duration || 0); };
    let scrub = false;
    bar.addEventListener('pointerdown', e => { scrub = true; bar.setPointerCapture(e.pointerId); seek(e); e.stopPropagation(); });
    bar.addEventListener('pointermove', e => { if (scrub) seek(e); });
    bar.addEventListener('pointerup', e => { scrub = false; e.stopPropagation(); });
    snd.addEventListener('click', () => { v.muted = !v.muted; snd.textContent = v.muted ? 'sound off' : 'sound on'; if (!v.muted && v.paused) v.play().catch(() => {}); });
    c.addEventListener('pointerdown', e => e.stopPropagation());
    c.addEventListener('click', e => e.stopPropagation());
    return c;
  }
  function build(item) {
    const fit = fitRect(item);
    const b = document.createElement('div'); b.className = 'v-media';
    b.style.width = fit.w + 'px'; b.style.height = fit.h + 'px';
    if (item.color) b.style.background = item.color;
    if (item.type === 'photo') {
      const lq = new Image(); lq.className = 'lq'; lq.alt = ''; lq.decoding = 'async'; lq.src = item.rail.src; b.appendChild(lq);
      if (pickTier(item, fit.w, fit.h) === 'full') {
        const hq = new Image(); hq.className = 'hq media'; hq.alt = ''; hq.decoding = 'async'; b.appendChild(hq);
        preloadImage(item.full.src).then(() => { if (!b.isConnected) return; hq.src = item.full.src; hq.decode().catch(() => {}).then(() => hq.classList.add('in')); }).catch(e => console.warn(e.message));
      }
    } else {
      const v = document.createElement('video');
      v.playsInline = true; v.muted = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
      v.poster = item.poster.full; v.src = item.full.src;
      b.appendChild(v); b.appendChild(controls(v, item)); video = v;
    }
    return { box: b, fit };
  }
  function caption(item) {
    // the shoot's name; when the brand or person has a page, the name is the way there
    const p = item.projectObj, i = idx();
    countEl.textContent = `${pad3(i + 1)} / ${pad3(list.length)}`;
    const name = p.link ? `<a class="proj" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : `<span class="proj">${esc(p.title)}</span>`;
    const parts = [name];
    if (p.credits) parts.push(`<span class="proj">${esc(p.credits)}</span>`);
    bottom.innerHTML = parts.join(' ');
  }
  function preloadNeighbours() {
    const i = idx();
    for (const j of [i + 1, i - 1]) { const it = list[(j + list.length) % list.length]; if (it?.type === 'photo') preloadImage(it.full.src).catch(() => {}); }
  }
  function show(item) {
    if (video) { video.pause(); video = null; }
    if (open && cur && cur.id !== item.id && source === 'rail') {
      if (takenId) { setTaken(takenId, false); takenId = null; }
      if (isOnRail(item.id)) { centerRail(item.id); takenId = item.id; setTaken(item.id, true); }
    }
    cur = item;
    const { box: b, fit } = build(item);
    stage.replaceChildren(b); box = b;
    caption(item); preloadNeighbours();
    return fit;
  }

  function api_open(item, items, { fromRect = null, source: src = 'rail' } = {}) {
    document.body.classList.add('viewer-open');
    lastFocus = document.activeElement; list = items; source = src; closing = false;
    el.hidden = false; open = true;
    const fit = show(item);
    void el.offsetWidth; el.classList.add('open');
    // the frame resolves out of a soft blur; nothing travels or scales
    if (!REDUCED.matches) box.animate([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: T2, easing: E_OUT });
    closeBtn.focus({ preventScroll: true });
  }
  function finish() {
    el.classList.remove('open'); el.hidden = true; open = false; document.body.classList.remove('viewer-open');
    if (video) { video.pause(); video = null; }
    stage.replaceChildren(); box = null;
    if (takenId) { setTaken(takenId, false); takenId = null; }
    lastFocus?.focus?.({ preventScroll: true }); lastFocus = null; cur = null;
  }
  function api_close({ animate = true } = {}) {
    if (!open || closing) return; closing = true;
    if (video) video.pause();
    el.classList.add('fading');
    const done = () => { el.classList.remove('fading'); finish(); };
    if (box && animate && !REDUCED.matches) settle(box.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }], { duration: T2, easing: E_OUT, fill: 'forwards' }), T2 + 60).then(done);
    else done();
  }
  function step(d) { if (list.length < 2) return; onNavigate(list[(idx() + d + list.length) % list.length]); }

  // ---- input
  closeBtn.addEventListener('click', () => onClose());
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  el.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Tab') { // focus trap
      const f = [...el.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter(x => !x.hidden && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  let sw = null;
  stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; sw = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId }; });
  stage.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id || !box || e.pointerType === 'mouse') return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (phone() && Math.abs(dy) > Math.abs(dx) && dy > 0) box.style.transform = `translateY(${dy}px)`; else box.style.transform = `translateX(${dx}px)`;
  });
  const swEnd = e => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = Math.max(1, e.timeStamp - sw.t);
    const vx = Math.abs(dx) / dt * 1000, vy = dy / dt * 1000;
    if (box) { box.style.transition = `transform ${T1}ms ${E_OUT}`; box.style.transform = ''; setTimeout(() => { if (box) box.style.transition = ''; }, T1 + 20); }   // the gesture settles back
    sw = null;
    if (e.pointerType === 'mouse') return;
    if (phone() && dy > 80 && Math.abs(dy) > Math.abs(dx) || vy > 700 && dy > 30) { onClose(); return; }
    if (Math.abs(dx) > 50 || vx > 500 && Math.abs(dx) > 20) step(dx < 0 ? 1 : -1);
  };
  stage.addEventListener('pointerup', swEnd);
  stage.addEventListener('pointercancel', () => { sw = null; if (box) box.style.transform = ''; });
  stage.addEventListener('click', e => { if (e.target === stage && !phone()) onClose(); });
  let rt = 0;
  addEventListener('resize', () => { if (!open || !box || !cur) return; clearTimeout(rt); rt = setTimeout(() => { const f = fitRect(cur); box.style.width = f.w + 'px'; box.style.height = f.h + 'px'; }, 100); });

  return { open: api_open, close: api_close, show: (item) => { if (open) show(item); }, get isOpen() { return open; }, get current() { return cur; } };
}
