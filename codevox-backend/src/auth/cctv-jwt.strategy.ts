import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import { SharedRbacService } from './shared-rbac.service';
import type { JwtUserPayload } from './types/jwt-user-payload';

function extractBearerToken(req: Request): string | null {
  const h = (req.headers['authorization'] ?? req.headers['Authorization']) as
    | string
    | string[]
    | undefined;
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  const m = /^Bearer\s+(.+)$/i.exec(v.trim());
  return m ? m[1] : null;
}

/** Local bearer token + shared RBAC tables. */
@Injectable()
export class CctvJwtStrategy extends PassportStrategy(Strategy, 'cctv-jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly rbac: SharedRbacService,
  ) {
    super();
  }

  async validate(req: Request): Promise<JwtUserPayload> {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const expected =
      this.config.get<string>('LOCAL_AUTH_TOKEN')?.trim() || 'local-dev-token';
    if (token !== expected) {
      throw new UnauthorizedException('Invalid token');
    }

    const email = (
      this.config.get<string>('LOCAL_AUTH_EMAIL') ?? 'akshat@CodeVox'
    )
      .trim()
      .toLowerCase();
    const name = (
      this.config.get<string>('LOCAL_AUTH_NAME') ?? 'Akshat'
    ).trim();
    const admno = (
      this.config.get<string>('LOCAL_AUTH_ADMNO') ?? 'local-admin'
    ).trim();
    const localId = `local:${admno}`;

    const appUser = await this.rbac.findOrCreateLocalUser({
      localId,
      email,
      name,
      admno,
    });

    const permissions = await this.rbac.getPermissionKeysForUserId(appUser.id);

    return {
      sub: String(appUser.id),
      email: appUser.email,
      name: appUser.name ?? undefined,
      localSub: localId,
      /** @deprecated use localSub */
      keycloakSub: localId,
      permissions,
    };
  }
}
