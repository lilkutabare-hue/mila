import { createStrip } from './strip.js?v=c1566379';
import { createWardrobe } from './wardrobe.js?v=c1566379';
import { createViewer } from './viewer.js?v=c1566379';
import { onRoute, navigate, back } from './router.js?v=c1566379';
import { shuffle, esc } from './media.js?v=c1566379';

// When embedded elsewhere (Tilda T123), window.MH_BASE points at the hosted folder; everything loads from there.
const BASE = (window.MH_BASE || new URL('../../', import.meta.url).href).replace(/\/?$/, '/');
const abs = u => (u && !/^(https?:)?\/\//.test(u) ? BASE + u : u);
import { MARKUP } from './markup.js?v=c1566379';
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

// ---- this visit: ordered projects first, the rest shuffled; 3–4 random works from each, in project order
const ordered = manifest.projects.filter(p => Number.isInteger(p.order)).sort((a, b) => a.order - b.order);
const visit = [...ordered, ...shuffle(manifest.projects.filter(p => !Number.isInteger(p.order)))];
const maxPer = Math.max(1, site.stripMax ?? 4), minPer = Math.max(1, Math.min(maxPer, site.stripMin ?? 3));
function pick(p) {
  const pool = p.itemObjs.filter(i => i.onRail);
  const n = Math.min(pool.length, minPer + Math.floor(Math.random() * (maxPer - minPer + 1)));
  const idx = shuffle(pool.map((_, i) => i)).slice(0, n).sort((a, b) => a - b);
  return idx.map(i => pool[i]);
}
let selected = visit.flatMap(pick);
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
if (site.railMode !== 'projects') selected = spread(selected);
// shoots with an explicit order are pinned to the start of the strip (first column = start screen)
const pinned = selected.filter(i => Number.isInteger(i.projectObj.order)).sort((a, b) => a.projectObj.order - b.projectObj.order);
selected = [...pinned, ...selected.filter(i => !pinned.includes(i))];

// ---- chrome
const $ = s => document.querySelector(s);
const navGallery = $('#nav-gallery'), navContact = $('#nav-contact');
const labelGallery = site.labels?.gallery || 'wardrobe', labelContact = site.labels?.contact || 'contact';
navGallery.textContent = labelGallery; navContact.textContent = labelContact;
const tidy = s => (s && /^TODO/i.test(s)) ? s.replace(/^TODO:?\s*/i, '') : (s || '');
const role = tidy(site.role);
document.title = [site.name, role].filter(Boolean).join(' — ');

// ---- contact
const contactEl = $('#contact');
{
  const links = [];
  if (site.instagram) links.push(`<a href="https://instagram.com/${esc(site.instagram)}" target="_blank" rel="noopener">instagram</a>`);
  if (tidy(site.email)) links.push(`<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`);
  if (tidy(site.telegram)) links.push(`<a href="https://t.me/${esc(site.telegram.replace(/^@/, ''))}" target="_blank" rel="noopener">telegram</a>`);
  $('#contact-body').innerHTML = `<h1>${esc(site.name)}</h1>${role ? `<p class="role">${esc(role)}${tidy(site.city) ? `, ${esc(tidy(site.city))}` : ''}</p>` : ''}${links.map(l => `<p>${l}</p>`).join('')}`;
  contactEl.addEventListener('click', e => { if (e.target === contactEl || e.target.id === 'contact-body') back(''); });
}

// ---- strips
const strip = createStrip({ items: selected, stage: $('#stage'), loop: true, layout: 'scatter', drift: 6, depth: 0.05, maxTier: innerWidth >= 1100 ? 'full' : 'rail', onOpen: item => navigate(`p/${item.projectObj.slug}`) });
const projectStrip = createStrip({ items: [], stage: $('#project-stage'), loop: false, loopIfWide: true, layout: 'band', swipeDown: true, onOpen: item => navigate(`look/${item.id}`) });
const wardrobe = createWardrobe({ el: $('#wardrobe'), projects: visit, onOpen: item => navigate(`look/${item.id}`) });
const viewer = createViewer({
  el: $('#viewer'), railRectOf: () => null, setTaken: () => {}, centerRail: () => {}, isOnRail: () => false,
  onNavigate: item => navigate(`look/${item.id}`, { replace: true }),
  onClose: () => back(layerOpen === 'wardrobe' ? 'wardrobe' : layerOpen === 'project' ? `p/${currentProject?.slug}` : ''),
});

// ---- layers
let layerOpen = null, currentProject = null;
const layers = { project: $('#project'), wardrobe: $('#wardrobe'), contact: contactEl };
function showLayer(which) {
  for (const [k, el] of Object.entries(layers)) {
    const on = k === which;
    if (on) { clearTimeout(el._t); if (el.hidden) { el.hidden = false; void el.offsetWidth; } el.classList.add('open'); }
    else if (!el.hidden) { el.classList.remove('open'); clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 380); }
  }
  layerOpen = which;
  document.body.classList.toggle('layer-open', !!which);
  document.body.classList.toggle('project-open', which === 'project');
  document.body.classList.toggle('contact-open', which === 'contact');
  document.body.classList.toggle('wardrobe-open', which === 'wardrobe');
  navGallery.setAttribute('href', which === 'wardrobe' ? '#/' : '#/wardrobe');
  navContact.setAttribute('href', which === 'contact' ? '#/' : '#/contact');
  navGallery.classList.toggle('on', which === 'wardrobe');
  navContact.classList.toggle('on', which === 'contact');
}
function openProject(p) {
  if (currentProject !== p) { currentProject = p; projectStrip.setItems(p.itemObjs); }
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
    let list = layerOpen === 'wardrobe' ? wardrobe.currentList() : layerOpen === 'project' ? currentProject.itemObjs : item.projectObj.itemObjs;
    if (!list.some(i => i.id === item.id)) list = item.projectObj.itemObjs;
    if (layerOpen === 'contact') showLayer(null);
    viewer.open(item, list, { source: 'wardrobe' });
    strip.pause(); projectStrip.pause();
    return;
  }
  if (viewer.isOpen) viewer.close({ animate: false });
  if (route.name === 'project') { if (projectsBySlug.has(route.slug)) { openProject(projectsBySlug.get(route.slug)); return; } navigate('', { replace: true }); return; }
  if (route.name === 'rail' && location.hash.replace(/^#\/?/, '')) { navigate('', { replace: true }); return; }
  projectStrip.pause();
  if (route.name === 'wardrobe') { showLayer('wardrobe'); wardrobe.open(route.slug); strip.pause(); }
  else if (route.name === 'contact') { showLayer('contact'); wardrobe.close(); strip.resume(); }
  else { showLayer(null); wardrobe.close(); strip.resume(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.isOpen && layerOpen) back(''); if (e.key === 'Tab') document.body.classList.add('kb'); });
addEventListener('pointerdown', () => document.body.classList.remove('kb'), true);
// leaving a shoot: tap the empty paper around the band, pull the band down, or press its title
const closeProject = () => { if (layerOpen === 'project') back(''); };
$('#project-stage').addEventListener('tapout', closeProject);
$('#project-stage').addEventListener('swipedown', closeProject);
$('#p-title').addEventListener('click', e => { if (!currentProject?.link) { e.preventDefault(); closeProject(); } });
window.__strip = strip; window.__pstrip = projectStrip;
