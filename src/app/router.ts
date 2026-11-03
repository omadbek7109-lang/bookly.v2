/**
 * Tiny hash router (works on static hosting, GitHub Pages and inside Telegram webviews
 * without server rewrites).
 */
import { useEffect, useState } from 'react';

export interface Route { path: string; parts: string[]; query: URLSearchParams }

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => listeners.forEach((l) => l()));

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const fn = () => setR(parse());
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return r;
}

let depth = 0;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) {
    history.replaceState(history.state, '', target);
    listeners.forEach((l) => l());
  } else if (location.hash !== target) {
    depth++;
    location.hash = target;
  }
  window.scrollTo({ top: 0 });
}

/** Goes back inside the app; falls back to a route when the page was opened directly. */
export function back(fallback = '/'): void {
  if (depth > 0) { depth--; history.back(); }
  else navigate(fallback, { replace: true });
}

export const routes = {
  home: () => '/',
  books: (tab?: string) => (tab ? `/books?tab=${tab}` : '/books'),
  studio: () => '/studio',
  templates: () => '/templates',
  profile: () => '/profile',
  create: (q = '') => `/create${q}`,
  editor: (id: string, chapter?: string) => `/editor/${id}${chapter ? `?ch=${chapter}` : ''}`,
  reader: (id: string) => `/reader/${id}`,
  cover: (id?: string) => (id ? `/cover/${id}` : '/cover'),
  export: (id?: string) => (id ? `/export/${id}` : '/export'),
  import: () => '/import',
};
