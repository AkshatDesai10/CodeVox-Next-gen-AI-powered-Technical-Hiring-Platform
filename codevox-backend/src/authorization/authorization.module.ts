import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoutePermissionGuard } from './guards/route-permission.guard';
import { RbacPermissionService } from './rbac-permission.service';

@Global()
@Module({
  providers: [
    JwtAuthGuard,
    RoutePermissionGuard,
    RbacPermissionService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RoutePermissionGuard },
  ],
  exports: [RoutePermissionGuard, RbacPermissionService],
})
export class AuthorizationModule {}
