import { PUBLIC_ROUTES } from './public-routes.constants';

export function normalizeHttpPath(req: {
  path?: string;
  url?: string;
  route?: { path?: string };
}): string {
  const raw = req.route?.path
    ? joinRoutePath(req.url ?? '', req.route.path)
    : (req.path ?? req.url ?? '/');
  const withoutQuery = raw.split('?')[0] ?? '/';
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function joinRoutePath(url: string, routePath: string): string {
  const base = url.split('?')[0] ?? url;
  const segments = base.split('/').filter(Boolean);
  const routeSegs = routePath.split('/').filter(Boolean);
  if (!routeSegs.length) return base;
  const prefixLen = Math.max(0, segments.length - routeSegs.length);
  const prefix = segments.slice(0, prefixLen);
  return `/${[...prefix, ...routeSegs].join('/')}`;
}

function segmentPattern(seg: string): string {
  if (seg === '*') return '.*';
  if (seg.startsWith(':')) return '[^/]+';
  return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function pathPatternToRegExp(pattern: string): RegExp {
  const parts = pattern.split('/').filter(Boolean);
  const body = parts.map(segmentPattern).join('/');
  return new RegExp(`^/${body}$`, 'i');
}

export function isPublicRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const normalized = path.split('?')[0] ?? path;
  for (const def of PUBLIC_ROUTES) {
    if (def.method.toUpperCase() !== m) continue;
    if (pathPatternToRegExp(def.path).test(normalized)) return true;
  }
  return false;
}
