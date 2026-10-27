import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { SystemConfigurationMysql } from './entities/system-configuration.mysql.entity';
import { SystemConfigurationLogMysql } from './entities/system-configuration-log.mysql.entity';
import { DynamicConfigService } from './dynamic-config.service';
import { ConfigurationsController } from './configurations.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemConfigurationMysql, SystemConfigurationLogMysql]),
    AuthorizationModule,
  ],
  controllers: [ConfigurationsController],
  providers: [DynamicConfigService],
  exports: [DynamicConfigService],
})
export class SystemConfigModule {}
