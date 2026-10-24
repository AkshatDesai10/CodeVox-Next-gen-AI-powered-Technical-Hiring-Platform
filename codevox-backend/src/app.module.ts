import './load-env';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { validateEnv } from './config/env.validation';
import { buildRecruitmentTypeOrmOptions } from './database/typeorm-recruitment.options';
import { HealthController } from './health.controller';
import { QueueModule } from './queue/queue.module';
import { AssessmentExecutionModule } from './modules/assessment-execution/assessment-execution.module';
import { AssessmentPlatformModule } from './modules/assessment-platform/assessment-orchestrator/assessment-platform.module';
import { AssessmentEngineModule } from './modules/assessment-platform/assessment-engine/assessment-engine.module';
import { AutonomousInterviewModule } from './modules/autonomous-interview/autonomous-interview.module';
import { JobProfilesModule } from './modules/job-profiles/job-profiles.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { AiDetectionModule } from './modules/ai-detection/ai-detection.module';
import { ProjectInterviewModule } from './modules/project-interview/project-interview.module';
import { CodingRoundModule } from './modules/coding-round/coding-round.module';
import { AssessmentReportsModule } from './modules/assessment-reports/assessment-reports.module';
import { EmailModule } from './modules/email/email.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: '.env',
      expandVariables: true,
    }),
    TypeOrmModule.forRoot(buildRecruitmentTypeOrmOptions()),
    QueueModule.register(),
    AuthModule,
    AuthorizationModule,
    AssessmentExecutionModule,
    AssessmentPlatformModule,
    AssessmentEngineModule,
    AutonomousInterviewModule,
    JobProfilesModule,
    RecruitmentModule,
    AiDetectionModule,
    ProjectInterviewModule,
    CodingRoundModule,
    AssessmentReportsModule,
    EmailModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
