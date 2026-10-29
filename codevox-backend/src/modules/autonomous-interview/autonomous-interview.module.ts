import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentExecutionModule } from '../assessment-execution/assessment-execution.module';
import { ProctorModule } from '../proctor/proctor.module';
import { JobProfilesModule } from '../job-profiles/job-profiles.module';
import { ProjectInterviewModule } from '../project-interview/project-interview.module';
import { CandidateAutonomousInterviewMysql } from './entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundMysql } from './entities/autonomous-interview-round.mysql.entity';
import { InterviewRecordingMysql } from './entities/interview-recording.mysql.entity';
import { InterviewRecordingService } from './interview-recording.service';
import { AutonomousInterviewRepository } from './autonomous-interview.repository';
import { AutonomousInterviewRoundsRepository } from './autonomous-interview-rounds.repository';
import { SessionCoordinatorService } from './session-coordinator.service';
import { AutonomousInterviewController } from './autonomous-interview.controller';
import { LiveKitService } from './livekit.service';
import { VoiceEngineClient } from './voice-engine.client';
import { InterviewViewportHub } from './interview-viewport.hub';
import { InterviewViewportGateway } from './interview-viewport.gateway';
import { ResumeSkillsResolver } from './resume-skills.resolver';
import { InterviewAuditService } from './interview-audit.service';
import { ScreeningAnalyzerService } from './screening-analyzer.service';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfileAiLogMysql } from '../job-profiles/entities/job-profile-ai-log.mysql.entity';
import { RoundSnapshotModule } from '../assessment-reports/round-snapshot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CandidateAutonomousInterviewMysql,
      AutonomousInterviewRoundMysql,
      InterviewRecordingMysql,
      JobProfileAiLogMysql,
    ]),
    AssessmentExecutionModule,
    ProctorModule,
    AssessmentAiModule,
    RoundSnapshotModule,
    forwardRef(() => JobProfilesModule),
    forwardRef(() => ProjectInterviewModule),
  ],
  controllers: [AutonomousInterviewController],
  providers: [
    AutonomousInterviewRoundsRepository,
    AutonomousInterviewRepository,
    SessionCoordinatorService,
    LiveKitService,
    VoiceEngineClient,
    InterviewViewportHub,
    InterviewViewportGateway,
    ResumeSkillsResolver,
    InterviewAuditService,
    ScreeningAnalyzerService,
    InterviewRecordingService,
  ],
  exports: [
    SessionCoordinatorService,
    AutonomousInterviewRepository,
    AutonomousInterviewRoundsRepository,
    InterviewRecordingService,
    LiveKitService,
  ],
})
export class AutonomousInterviewModule {}
