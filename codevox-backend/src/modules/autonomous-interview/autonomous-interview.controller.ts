import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { SessionCoordinatorService } from './session-coordinator.service';
import { InterviewAuditService } from './interview-audit.service';
import { AutonomousInterviewDecision } from './entities/candidate-autonomous-interview.mysql.entity';
import type { ProctorEventInput } from '../proctor/proctor.types';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/autonomous-interview')
export class AutonomousInterviewController {
  constructor(
    private readonly coordinator: SessionCoordinatorService,
    private readonly audit: InterviewAuditService,
  ) {}

  @Get('admin/reports')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('assessments:read')
  async listReports() {
    return ok('Interview reports listed', await this.audit.listReports());
  }

  @Post('admin/monitor/:token')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async adminMonitorJoin(
    @Param('token') token: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() body?: { round_type?: string },
  ) {
    const adminId = user.name?.trim() || user.email || user.sub;
    return ok(
      'Admin monitor join ready',
      await this.coordinator.createAdminMonitorJoin(token, adminId, body),
    );
  }

  @Get('admin/reports/:token/:filename')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('assessments:read')
  async getReportByFilename(
    @Param('token') token: string,
    @Param('filename') filename: string,
  ) {
    return ok('Interview report fetched', await this.audit.getReport(token, filename));
  }

  @Get('admin/reports/:token')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('assessments:read')
  async getLatestReport(@Param('token') token: string) {
    return ok('Interview report fetched', await this.audit.getReport(token));
  }

  /** Public executive-summary card — HMAC share token, no admin JWT. */
  @Get('reports/share/:shareToken')
  async getSharedReport(@Param('shareToken') shareToken: string) {
    return ok(
      'Shared interview executive summary',
      await this.audit.getSharedExecutiveCard(shareToken),
    );
  }

  @Get('session/:token')
  async getSession(@Param('token') token: string) {
    return ok('Session fetched', await this.coordinator.getSession(token));
  }

  @Post('session/:token/init')
  async initSession(@Param('token') token: string) {
    return ok('Session initialized', await this.coordinator.initializeSession(token));
  }

  @Post('session/:token/candidate-ready')
  async candidateReady(@Param('token') token: string) {
    return ok('Voice ready', await this.coordinator.candidateReady(token));
  }

  @Post('session/:token/voice-message')
  async voiceMessage(
    @Param('token') token: string,
    @Body() body: { message?: string },
  ) {
    return ok(
      'Voice turn processed',
      await this.coordinator.processVoiceMessage(token, body.message ?? ''),
    );
  }

  @Post('session/:token/consent')
  async recordConsent(@Param('token') token: string) {
    return ok('Consent recorded', await this.coordinator.recordConsent(token));
  }

  @Post('session/:token/identity-verify')
  async verifyIdentity(
    @Param('token') token: string,
    @Body() body: { descriptor: number[]; capture_quality?: number },
  ) {
    return ok('Identity verified', await this.coordinator.verifyIdentity(token, body));
  }

  @Post('session/:token/liveness-verify')
  async verifyLiveness(
    @Param('token') token: string,
    @Body()
    body: {
      challenge_id: string;
      passed: boolean;
      motion_score?: number;
      steps_completed?: string[];
      vendor_session_id?: string;
    },
  ) {
    return ok('Liveness verified', await this.coordinator.verifyLiveness(token, body));
  }

  @Post('session/:token/voice-enroll')
  async enrollVoice(
    @Param('token') token: string,
    @Body() body: { audio_base64?: string; embedding?: number[] },
  ) {
    return ok('Voice enrolled', await this.coordinator.enrollVoice(token, body));
  }

  @Post('session/:token/voice-check')
  async checkVoice(
    @Param('token') token: string,
    @Body() body: { audio_base64?: string; embedding?: number[]; phase?: string },
  ) {
    return ok('Voice checked', await this.coordinator.checkVoice(token, body));
  }

  @Post('session/:token/proctor-events')
  async proctorEvents(
    @Param('token') token: string,
    @Body() body: { events?: { type: string; severity: string; payload?: object; client_ts?: number }[] },
  ) {
    return ok(
      'Proctor events ingested',
      await this.coordinator.ingestProctorEvents(
        token,
        (body.events ?? []) as ProctorEventInput[],
      ),
    );
  }

  @Get('proctor-events/:token')
  async getProctorEvents(
    @Param('token') token: string,
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok('Proctor events', await this.coordinator.getProctorEventsForAudit(token));
  }

  @Post('session/:token/merged-recording')
  async saveMergedRecordingUrl(
    @Param('token') token: string,
    @Body()
    body: {
      recordingUrl: string;
      stage_id?: string;
      stageId?: string;
      tracks?: { kind: string; url: string }[];
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    const stageId = body.stage_id ?? body.stageId ?? null;
    await this.coordinator.saveMergedRecordingUrl(token, body.recordingUrl, stageId);
    if (body.tracks && body.tracks.length > 0) {
      await this.coordinator.saveRawTracks(token, body.tracks, stageId);
    }
    return ok('Merged recording URL and tracks saved', null);
  }

  @Post('voice-chat-sync')
  async voiceChatSync(
    @Body()
    body: {
      candidate_token: string;
      chat_history?: Record<string, unknown>[];
      phase?: 'ai_verbal' | 'hr_verbal' | 'ai_screening' | 'bnd_interview' | 'unified';
      turn_index?: number;
      reply_latency_ms?: number;
      stt_confidence?: number;
      speech_start_delay_ms?: number;
      utterance_duration_ms?: number;
      user_text?: string;
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Voice chat synced',
      await this.coordinator.syncVoiceChat(
        body.candidate_token,
        body.chat_history ?? [],
        body.phase ?? 'ai_verbal',
        {
          turn_index: body.turn_index,
          reply_latency_ms: body.reply_latency_ms,
          stt_confidence: body.stt_confidence,
          speech_start_delay_ms: body.speech_start_delay_ms,
          utterance_duration_ms: body.utterance_duration_ms,
          user_text: body.user_text,
        },
      ),
    );
  }

  @Post('save-intro-results')
  async saveIntroResults(
    @Body()
    body: {
      candidate_token: string;
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Intro results saved',
      await this.coordinator.saveIntroResults(body.candidate_token, {
        stage1_voice_score: body.stage1_voice_score,
        stage1_chat_history: body.stage1_chat_history,
        stage1_voice_audit: body.stage1_voice_audit,
      }),
    );
  }

  @Post('assessment-active')
  async assessmentActive(
    @Body()
    body: {
      candidate_token: string;
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Assessment active',
      await this.coordinator.transitionToAssessmentActive(body.candidate_token, {
        stage1_voice_score: body.stage1_voice_score,
        stage1_chat_history: body.stage1_chat_history,
        stage1_voice_audit: body.stage1_voice_audit,
      }),
    );
  }

  @Post('screen-share-ready')
  async screenShareReady(
    @Body() body: { candidate_token: string },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Screen share ready',
      await this.coordinator.notifyScreenShareReady(body.candidate_token),
    );
  }

  @Post('shift-to-sandbox')
  async shiftToSandbox(
    @Body()
    body: {
      candidate_token: string;
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Shifted to sandbox',
      await this.coordinator.transitionToSandbox(body.candidate_token, {
        stage1_voice_score: body.stage1_voice_score,
        stage1_chat_history: body.stage1_chat_history,
      }),
    );
  }

  @Post('final-submit')
  async finalSubmit(
    @Body()
    body: {
      candidate_token: string;
      source_code: string;
      language?: string;
    },
  ) {
    return ok(
      'Assessment submitted — closing phase',
      await this.coordinator.finalizeAssessmentSubmission(
        body.candidate_token,
        body.source_code,
        body.language,
      ),
    );
  }

  @Post('session/:token/force-complete')
  async forceComplete(
    @Param('token') token: string,
    @Body()
    body?: {
      ended_by?: 'candidate' | 'proctor';
      termination_reason?: string;
    },
  ) {
    const endedBy =
      body?.ended_by === 'candidate'
        ? 'candidate'
        : body?.ended_by === 'proctor'
          ? 'proctor'
          : undefined;
    return ok(
      'Interview forcefully completed',
      await this.coordinator.completeInterview(token, {
        ended_by: endedBy,
        termination_reason: body?.termination_reason,
      }),
    );
  }

  @Post('defend-assessment-started')
  async defendAssessmentStarted(
    @Body() body: { candidate_token: string },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Defend assessment started',
      await this.coordinator.beginDefendAssessment(body.candidate_token),
    );
  }

  @Post('complete')
  async complete(
    @Body()
    body: {
      candidate_token: string;
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
      stage3_chat_history?: Record<string, unknown>[];
      hr_voice_audit?: Record<string, unknown>;
      final_decision?: AutonomousInterviewDecision;
      ended_by?: 'candidate';
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'Interview completed',
      await this.coordinator.completeInterview(body.candidate_token, body),
    );
  }

  @Post('complete-screening')
  async completeScreening(
    @Body()
    body: {
      candidate_token: string;
      transcript?: Array<Record<string, unknown>>;
      conversation_state?: Record<string, unknown>;
      round_config?: Record<string, unknown>;
      job_profile_context?: Record<string, unknown>;
      ended_by?: 'candidate';
      merge_to_verbal?: boolean;
    },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'AI Screening completed',
      await this.coordinator.completeAiScreening(body.candidate_token, body),
    );
  }

  @Post('retry-screening-analyzer')
  async retryScreeningAnalyzer(
    @Body() body: { candidate_token: string },
    @Headers('x-service-key') serviceKey?: string,
  ) {
    this.coordinator.assertServiceKey(serviceKey);
    return ok(
      'AI Screening analyzer retry started',
      await this.coordinator.retryScreeningAnalyzer(body.candidate_token),
    );
  }
}
