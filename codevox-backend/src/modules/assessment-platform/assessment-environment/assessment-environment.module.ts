import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentTemplateMysql } from '../entities/environment-template.mysql.entity';
import { WorkspaceProvisionMysql } from '../entities/workspace-provision.mysql.entity';
import {
  ComposeWorkspaceProvisioner,
  EnvironmentProvisionerRegistry,
  EnvironmentTemplateService,
  SingleContainerProvisioner,
} from './environment.services';

@Module({
  imports: [TypeOrmModule.forFeature([EnvironmentTemplateMysql, WorkspaceProvisionMysql])],
  providers: [
    EnvironmentTemplateService,
    SingleContainerProvisioner,
    ComposeWorkspaceProvisioner,
    EnvironmentProvisionerRegistry,
  ],
  exports: [EnvironmentTemplateService, EnvironmentProvisionerRegistry],
})
export class AssessmentEnvironmentModule {}
