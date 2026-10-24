/** Must match `basePath` in next.config.js. */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '/recruitment').replace(/\/$/, '');

function prefix(path: string): string {
  if (!BASE_PATH || path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Add the app basePath to URLs used outside `next/link` (plain `<a>`, iframes,
 * `window.location`). Without it, `/autonomous-interview/...` resolves to the
 * support app on the same domain, whose backend requires staff auth.
 */
export function withBasePath(url: string): string {
  if (!url) return url;
  if (url.startsWith('/')) return prefix(url);
  if (typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url);
    if (parsed.host !== window.location.host) return url;
    return `${parsed.origin}${prefix(parsed.pathname)}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
