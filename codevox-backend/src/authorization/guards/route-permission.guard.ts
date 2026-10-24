import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROUTE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { isPublicRoute, normalizeHttpPath } from '../route-permissions.registry';
import { isRbacBypassEnabled } from '../../config/rbac-bypass';

@Injectable()
export class RoutePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const explicit = this.reflector.getAllAndOverride<string[]>(
      ROUTE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<{
      user?: JwtUserPayload;
      method?: string;
      path?: string;
      url?: string;
      route?: { path?: string };
    }>();

    const method = (req.method ?? 'GET').toUpperCase();
    const path = normalizeHttpPath(req);
    if (isPublicRoute(method, path)) {
      return true;
    }

    const required = explicit?.length ? explicit : [];
    if (!required.length) {
      return true;
    }

    if (isRbacBypassEnabled()) {
      return true;
    }

    const user = req.user;
    if (!user?.sub) {
      throw new ForbiddenException('Authentication required');
    }

    const owned = new Set(
      (user.permissions ?? [])
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
    );
    const allowed = required.some((r) => owned.has(r.trim().toLowerCase()));
    if (!allowed) {
      throw new ForbiddenException({
        message: 'Insufficient permissions',
        required,
        email: user.email,
      });
    }
    return true;
  }
}
