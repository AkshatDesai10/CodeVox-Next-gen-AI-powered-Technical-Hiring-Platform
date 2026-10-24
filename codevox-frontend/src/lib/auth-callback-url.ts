/** Safe post-login path for NextAuth `callbackUrl` (must be same-origin, path-only). */
export function safeAuthCallbackUrl(raw: string | null | undefined): string {
  const fallback = '/';
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const allowedOrigins = new Set<string>();

    if (typeof window !== 'undefined') {
      allowedOrigins.add(window.location.origin);
    }

    const nextAuthUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, '');
    if (nextAuthUrl) {
      try {
        allowedOrigins.add(new URL(nextAuthUrl).origin);
      } catch {
        /* ignore */
      }
    }

    const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
    if (publicAppUrl) {
      try {
        allowedOrigins.add(new URL(publicAppUrl).origin);
      } catch {
        /* ignore */
      }
    }

    if (allowedOrigins.has(parsed.origin)) {
      const path = parsed.pathname + parsed.search + parsed.hash;
      return path && path !== '/' ? path : fallback;
    }
  } catch {
    /* ignore invalid URL */
  }

  return fallback;
}
