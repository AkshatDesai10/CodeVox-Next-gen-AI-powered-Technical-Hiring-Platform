import { SetMetadata } from '@nestjs/common';

export const ROUTE_PERMISSION_KEY = 'route_permissions';

export const RequirePermissions = (...keys: string[]) =>
  SetMetadata(ROUTE_PERMISSION_KEY, keys);

/** @deprecated Use {@link RequirePermissions} */
export const RequirePermission = RequirePermissions;
