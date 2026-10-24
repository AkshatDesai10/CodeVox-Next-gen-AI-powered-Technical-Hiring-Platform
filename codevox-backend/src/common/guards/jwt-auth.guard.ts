import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  isPublicRoute,
  normalizeHttpPath,
} from '../../authorization/route-permissions.registry';

@Injectable()
export class JwtAuthGuard extends AuthGuard('cctv-jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
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
    return super.canActivate(context);
  }
}
