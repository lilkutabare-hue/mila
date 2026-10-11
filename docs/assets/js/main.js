import { createStrip } from './strip.js?v=5dc2e402';
import { createWardrobe } from './wardrobe.js?v=5dc2e402';
import { createViewer } from './viewer.js?v=5dc2e402';
import { onRoute, navigate, back, parse } from './router.js?v=5dc2e402';
import { shuffle, esc } from './media.js?v=5dc2e402';

// When embedded elsewhere (Tilda T123), window.MH_BASE points at the hosted folder; everything loads from there.
const BASE = (window.MH_BASE || new URL('../../', import.meta.url).href).replace(/\/?$/, '/');
const abs = u => (u && !/^(https?:)?\/\//.test(u) ? BASE + u : u);
import { MARKUP } from './markup.js?v=5dc2e402';
if (!document.getElementById('stage')) document.body.insertAdjacentHTML('beforeend', MARKUP);
const manifest = await (await fetch(BASE + 'data/manifest.json', { cache: 'no-cache' })).json();
const site = manifest.site || {};
for (const i of manifest.items) {
  i.rail.src = abs(i.rail.src); i.full.src = abs(i.full.src); if (i.small) i.small.src = abs(i.small.src);
  if (i.poster) { i.poster.rail = abs(i.poster.rail); i.poster.full = abs(i.poster.full); }
}
const itemsById = new Map(manifest.items.map(i => [i.id, i]));
const projectsBySlug = new Map();
for (const p of manifest.projects) {
  p.itemObjs = p.items.map(id => itemsById.get(id)).filter(Boolean);
  p.itemObjs.forEach(i => { i.projectObj = p; });
  projectsBySlug.set(p.slug, p);
}

// ---- roles: every work is either mila in front of the camera (model) or her styling on someone else (styling)
const ROLES = ['model', 'styling'];
let picked = parse().name === 'role' ? parse().role : null;   // null — everything
const ofRole = (p, r = picked) => r ? p.itemObjs.filter(i => i.role === r) : p.itemObjs;
const home = () => picked || '';                               // where closing a layer lands: the strip as it was filtered

// ---- this visit: ordered projects first, the rest shuffled; 3–4 random works from each, in project order
const ordered = manifest.projects.filter(p => Number.isInteger(p.order)).sort((a, b) => a.order - b.order);
const visit = [...ordered, ...shuffle(manifest.projects.filter(p => !Number.isInteger(p.order)))];
const maxPer = Math.max(1, site.stripMax ?? 4), minPer = Math.max(1, Math.min(maxPer, site.stripMin ?? 3));
function pick(p, r) {
  const mine = ofRole(p, r);
  let pool = mine.filter(i => i.onRail); if (!pool.length) pool = mine;   // a role that lives past the rail cut still gets frames
  const n = Math.min(pool.length, minPer + Math.floor(Math.random() * (maxPer - minPer + 1)));
  const idx = shuffle(pool.map((_, i) => i)).slice(0, n).sort((a, b) => a - b);
  return idx.map(i => pool[i]);
}
// mix: random order, but frames of one shoot never land next to each other (window of 3)
function spread(list, window = 3) {
  const out = shuffle(list.slice());
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let i = 0; i < out.length; i++) {
      const clash = j => j >= 0 && j < out.length && j !== i && Math.abs(j - i) < window && out[j].projectObj === out[i].projectObj;
      if (![i - 2, i - 1, i + 1, i + 2].some(clash)) continue;
      bad++;
      for (let k = 0; k < out.length; k++) { // find a slot where neither side clashes
        const okHere = ![i - 2, i - 1, i + 1, i + 2].some(j => j >= 0 && j < out.length && j !== k && out[j].projectObj === out[k].projectObj);
        const okThere = ![k - 2, k - 1, k + 1, k + 2].some(j => j >= 0 && j < out.length && j !== i && out[j].projectObj === out[i].projectObj);
        if (k !== i && okHere && okThere) { [out[i], out[k]] = [out[k], out[i]]; break; }
      }
    }
    if (!bad) break;
  }
  return out;
}
// one selection per role for the whole visit: switching back and forth shows the same frames
const selections = new Map();
function selectionFor(r) {
  if (selections.has(r)) return selections.get(r);
  let selected = visit.flatMap(p => pick(p, r));
  if (site.railMode !== 'projects') selected = spread(selected);
  // shoots with an explicit order are pinned to the start of the strip (first column = start screen)
  const pinned = selected.filter(i => Number.isInteger(i.projectObj.order)).sort((a, b) => a.projectObj.order - b.projectObj.order);
  selected = [...pinned, ...selected.filter(i => !pinned.includes(i))];
  selections.set(r, selected); return selected;
}

// ---- chrome
const $ = s => document.querySelector(s);
const navGallery = $('#nav-gallery'), navContact = $('#nav-contact');
const labelGallery = site.labels?.gallery || 'gallery', labelContact = site.labels?.contact || 'contact';
navGallery.textContent = labelGallery; navContact.textContent = labelContact;
const tidy = s => (s && /^TODO/i.test(s)) ? s.replace(/^TODO:?\s*/i, '') : (s || '');
const role = tidy(site.role);
document.title = [site.name, role].filter(Boolean).join(' — ');

// ---- contact
const contactEl = $('#contact');
{
  const links = [];
  if (site.instagram) links.push(`<a href="https://instagram.com/${esc(site.instagram)}" target="_blank" rel="noopener">instagram</a>`);
  if (tidy(site.telegram)) links.push(`<a href="https://t.me/${esc(site.telegram.replace(/^@/, ''))}" target="_blank" rel="noopener">telegram</a>`);
  if (tidy(site.email)) links.push(`<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`);
  $('#contact-body').innerHTML = `<h1>${esc(site.name)}</h1>${role ? `<p class="role">${esc(role)}${tidy(site.city) ? `, ${esc(tidy(site.city))}` : ''}</p>` : ''}${links.map(l => `<p>${l}</p>`).join('')}`;
  contactEl.addEventListener('click', e => { if (e.target === contactEl || e.target.id === 'contact-body') back(home()); });
}

// ---- strips
const strip = createStrip({ items: selectionFor(picked), stage: $('#stage'), loop: true, layout: 'scatter', maxTier: innerWidth >= 1100 ? 'full' : 'rail', onOpen: item => navigate(`p/${item.projectObj.slug}`) });
const projectStrip = createStrip({ items: [], stage: $('#project-stage'), loop: false, loopIfWide: true, layout: 'band', swipeDown: true, onOpen: item => navigate(`look/${item.id}`) });
// wardrobe reads top to bottom from the oldest shoot to the newest; shoots without a year come first, in their folder order
const byYear = manifest.projects.slice().sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
const wardrobe = createWardrobe({ el: $('#wardrobe'), projects: byYear, role: picked, onOpen: item => navigate(`look/${item.id}`) });
const viewer = createViewer({
  el: $('#viewer'), railRectOf: () => null, setTaken: () => {}, centerRail: () => {}, isOnRail: () => false,
  onNavigate: item => navigate(`look/${item.id}`, { replace: true }),
  onClose: () => back(layerOpen === 'wardrobe' ? 'gallery' : layerOpen === 'project' ? `p/${currentProject?.slug}` : home()),
});

// ---- model / styling: tap a word to see only that side of the work, tap it again for everything
const rolesEl = $('.roles'), navRoles = new Map(ROLES.map(r => [r, $('#nav-' + r)]));
function paintRoles() {
  rolesEl.classList.toggle('picked', !!picked);
  for (const [r, a] of navRoles) { a.classList.toggle('on', r === picked); if (r === picked) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
}
function setRole(r) {
  if (r === picked) return;
  picked = r; paintRoles(); paintNav(); wardrobe.setRole(r);
  strip.swap(selectionFor(r));   // frames riffle out and the new set lands; refilled from the start
}
for (const [r, a] of navRoles) {
  a.textContent = site.labels?.[r] || r;
  a.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const next = picked === r ? null : r;
    setRole(next);
    if (layerOpen !== 'wardrobe') navigate(next || '', { replace: true });   // the wardrobe refilters in place
  });
}
paintRoles();

// ---- layers
let layerOpen = null, currentProject = null, currentItems = [], currentKey = '';
const layers = { project: $('#project'), wardrobe: $('#wardrobe'), contact: contactEl };
// the open word leads back to the strip, filtered as it was
function paintNav() {
  navGallery.setAttribute('href', layerOpen === 'wardrobe' ? '#/' + home() : '#/gallery');
  navContact.setAttribute('href', layerOpen === 'contact' ? '#/' + home() : '#/contact');
}
function showLayer(which) {
  for (const [k, el] of Object.entries(layers)) el.classList.toggle('open', k === which);   // a closed layer stays laid out, only invisible
  layerOpen = which;
  document.body.classList.toggle('layer-open', !!which);
  document.body.classList.toggle('project-open', which === 'project');
  document.body.classList.toggle('contact-open', which === 'contact');
  document.body.classList.toggle('wardrobe-open', which === 'wardrobe');
  paintNav();
  navGallery.classList.toggle('on', which === 'wardrobe');
  navContact.classList.toggle('on', which === 'contact');
}
function openProject(p) {
  // with a role picked, a shoot shows only that side of it (a shoot with none of it shows everything)
  const key = p.slug + '|' + (picked || '');
  if (currentKey !== key) { currentProject = p; currentKey = key; const mine = ofRole(p); currentItems = mine.length ? mine : p.itemObjs; projectStrip.setItems(currentItems); }
  const t = $('#p-title'); t.textContent = p.title; if (p.year) { const y = document.createElement('span'); y.className = 'yr'; y.textContent = p.year; t.appendChild(y); }
  if (p.link) { t.href = p.link; t.target = '_blank'; t.rel = 'noopener'; t.classList.add('linked'); }
  else { t.removeAttribute('href'); t.removeAttribute('target'); t.classList.remove('linked'); }
  showLayer('project'); wardrobe.close(); strip.pause();
  projectStrip.resume(); if (!projectStrip.active) projectStrip.start();
}

strip.start();
onRoute(route => {
  if (route.name === 'look') {
    const item = itemsById.get(route.id);
    if (!item) { navigate('', { replace: true }); return; }
    if (viewer.isOpen) { viewer.show(item); return; }
    let list = layerOpen === 'wardrobe' ? wardrobe.currentList() : layerOpen === 'project' ? currentItems : ofRole(item.projectObj);
    if (!list.some(i => i.id === item.id)) list = item.projectObj.itemObjs;
    if (layerOpen === 'contact') showLayer(null);
    viewer.open(item, list, { source: 'wardrobe' });
    strip.pause(); projectStrip.pause();
    return;
  }
  if (viewer.isOpen) viewer.close({ animate: false });
  if (route.name === 'project') { if (projectsBySlug.has(route.slug)) { openProject(projectsBySlug.get(route.slug)); return; } navigate('', { replace: true }); return; }
  if (route.name === 'rail' && location.hash.replace(/^#\/?/, '')) { navigate('', { replace: true }); return; }
  if (route.name === 'role') setRole(route.role);
  projectStrip.pause();
  if (route.name === 'wardrobe') { showLayer('wardrobe'); wardrobe.open(route.slug); strip.pause(); }
  else if (route.name === 'contact') { showLayer('contact'); wardrobe.close(); strip.resume(); }
  else { showLayer(null); wardrobe.close(); strip.resume(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.isOpen && layerOpen) back(home()); if (e.key === 'Tab') document.body.classList.add('kb'); });
addEventListener('pointerdown', () => document.body.classList.remove('kb'), true);
// leaving a shoot: tap the empty paper around the band, pull the band down, or press its title
const closeProject = () => { if (layerOpen === 'project') back(home()); };
$('#project-stage').addEventListener('tapout', closeProject);
$('#project-stage').addEventListener('swipedown', closeProject);
$('#p-title').addEventListener('click', e => { if (!currentProject?.link) { e.preventDefault(); closeProject(); } });
// preloader leaves once what the visitor will see first is decoded: the first screen and the one next to it
{
  const t0 = performance.now(), MAX = 4500, MIN = 700;
  const watched = () => { const cur = layerOpen === 'project' ? projectStrip : strip; const vw = innerWidth; return cur.debugNodes().filter(n => { const r = n.el.getBoundingClientRect(); return r.right > -vw * 0.3 && r.left < vw * 1.8; }); };
  const iv = setInterval(() => {
    const el = performance.now() - t0, ns = watched();
    const ready = ns.length && ns.every(n => n.el.classList.contains('loaded') && (!n.media || n.media.tagName !== 'IMG' || n.media.complete));
    if ((ready && el > MIN) || el > MAX || viewer.isOpen || layerOpen === 'wardrobe' || layerOpen === 'contact') { clearInterval(iv); window.MH_HIDE_LOADER?.(); }
  }, 80);
}
// the gallery's rows are laid out while nobody looks, so opening it is only a fade
(window.requestIdleCallback || (f => setTimeout(f, 800)))(() => wardrobe.prepare());
window.__strip = strip; window.__pstrip = projectStrip;
