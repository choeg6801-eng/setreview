// 해시 기반 라우터: /app/#/e/bruno-mars-seoul?tab=live
const routes = [];

export function route(pattern, load) {
  // '/e/:slug' → 정규식
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ re, keys, load });
}

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || '/', query };
}

export function match(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { load: r.load, params };
    }
  }
  return null;
}

export function href(path, query) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  return '#' + path + (qs ? '?' + qs : '');
}

export function navigate(path, query, { replace = false } = {}) {
  const h = href(path, query);
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
