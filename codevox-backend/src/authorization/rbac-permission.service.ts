import { Injectable } from '@nestjs/common';
import type { JwtUserPayload } from '../auth/types/jwt-user-payload';
import { SharedRbacService } from '../auth/shared-rbac.service';
import { isRbacBypassEnabled } from '../config/rbac-bypass';

/**
 * Slim RBAC helper for recruitment modules — uses the same shared MySQL tables
 * as the main backend via {@link SharedRbacService}.
 */
@Injectable()
export class RbacPermissionService {
  constructor(private readonly sharedRbac: SharedRbacService) {}

  async hasPermission(user: JwtUserPayload, permissionKey: string): Promise<boolean> {
    return this.hasAnyPermission(user, [permissionKey]);
  }

  async hasAnyPermission(
    user: JwtUserPayload,
    permissionKeys: string[],
  ): Promise<boolean> {
    if (!permissionKeys.length) return true;
    if (isRbacBypassEnabled()) return true;

    const owned = user.permissions?.length
      ? user.permissions
      : await this.sharedRbac.getPermissionKeysForUserId(user.sub);

    const set = new Set(owned.map((p) => p.trim().toLowerCase()).filter(Boolean));
    return permissionKeys.some((k) => set.has(k.trim().toLowerCase()));
  }
}
