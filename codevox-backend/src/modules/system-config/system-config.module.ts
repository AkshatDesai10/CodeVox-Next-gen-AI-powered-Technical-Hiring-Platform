import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { SystemConfigurationMysql } from './entities/system-configuration.mysql.entity';
import { DynamicConfigService } from './dynamic-config.service';
import {
  CandidateRuntimeConfigController,
  SystemConfigController,
} from './system-config.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SystemConfigurationMysql]), AuthorizationModule],
  controllers: [SystemConfigController, CandidateRuntimeConfigController],
  providers: [DynamicConfigService],
  exports: [DynamicConfigService],
})
export class SystemConfigModule {}
