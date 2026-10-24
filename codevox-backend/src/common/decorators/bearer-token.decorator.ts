import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export function tryExtractBearerToken(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const h = req.headers?.authorization ?? req.headers?.Authorization;
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  const m = /^Bearer\s+(.+)$/i.exec(v.trim());
  return m?.[1]?.trim() || null;
}

function extractBearerToken(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const token = tryExtractBearerToken(req);
  if (!token) throw new UnauthorizedException('Missing bearer token');
  return token;
}

export const BearerToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return extractBearerToken(req);
});
