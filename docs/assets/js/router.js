// Hash router: '' | #/model | #/styling | #/wardrobe | #/wardrobe/<slug> | #/look/<id> | #/contact
export function parse(hash = location.hash) {
  const h = decodeURIComponent(hash).replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!h) return { name: 'rail' };
  const [a, b] = h.split('/');
  if (a === 'wardrobe') return { name: 'wardrobe', slug: b || null };
  if (a === 'look' && b) return { name: 'look', id: b };
  if (a === 'contact') return { name: 'contact' };
  if (a === 'model' || a === 'styling') return { name: 'role', role: a };
  if (a === 'p' && b) return { name: 'project', slug: b };
  return { name: 'rail' };
}
let depth = history.state?.depth ?? 0;
let handler = null, last = null;
export function navigate(hash, { replace = false } = {}) {
  const url = hash ? '#/' + hash.replace(/^#\/?/, '') : location.pathname + location.search;
  if (replace) history.replaceState({ depth }, '', url); else { depth++; history.pushState({ depth }, '', url); }
  fire();
}
function fire(force) {
  depth = history.state?.depth ?? depth;
  if (!force && location.hash === last) return;
  last = location.hash; handler?.(parse());
}
export function canGoBack() { return (history.state?.depth ?? 0) > 0; }
export function back(fallback = '') { if (canGoBack()) history.back(); else navigate(fallback, { replace: true }); }
export function onRoute(fn) {
  handler = fn;
  addEventListener('popstate', () => fire());
  addEventListener('hashchange', () => fire());
  // in-page links go through navigate() so history depth stays accurate
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#/"], a[href="#"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); navigate(a.getAttribute('href').replace(/^#\/?/, ''));
  });
  fire(true);
}
