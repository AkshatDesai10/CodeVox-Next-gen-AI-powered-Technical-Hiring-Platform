import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CctvJwtStrategy } from './cctv-jwt.strategy';
import { SharedRbacService } from './shared-rbac.service';

@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'cctv-jwt' })],
  providers: [SharedRbacService, CctvJwtStrategy],
  exports: [PassportModule, SharedRbacService],
})
export class AuthModule {}
