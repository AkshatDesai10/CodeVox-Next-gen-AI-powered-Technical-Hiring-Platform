import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InterviewProctorSessionType } from './entities/interview-proctor-event.mysql.entity';
import { InterviewGlobalConfigRepository } from './interview-global-config.repository';
import { resolveLivenessProvider } from './liveness/liveness-provider';
import { ProctorRepository } from './proctor.repository';
import {
  euclideanDistance,
  ProctorEventInput,
  VoiceTurnTimingMeta,
} from './proctor.types';
import { resolveProctorStrikeConfig } from './proctor-env.config';
import {
  evaluateRecruitmentFraudSignals,
  TurnHistorySample,
} from './recruitment-fraud.heuristics';
import {
  computeVoiceFingerprint,
  decodeBase64Pcm16,
  voiceFingerprintDistance,
} from './voice-biometrics.util';
import { DynamicConfigService } from '../system-config/dynamic-config.service';

export type InterviewSessionProctorRow = {
  candidateToken: string;
  consentRecordedAt: Date | null;
  identityVerifiedAt: Date | null;
  referenceFaceDescriptor: number[] | null;
  livenessVerifiedAt: Date | null;
  voiceReferenceEmbedding: number[] | null;
  proctorSummary: object | null;
};

@Injectable()
export class InterviewProctorService {
  private readonly logger = new Logger(InterviewProctorService.name);
  private readonly turnHistory = new Map<string, TurnHistorySample[]>();

  constructor(
    private readonly proctorRepo: ProctorRepository,
    private readonly configRepo: InterviewGlobalConfigRepository,
    private readonly dynamicConfig: DynamicConfigService,
  ) {}

  private strikeConfig() {
    return resolveProctorStrikeConfig((key, fallback = '') =>
      this.dynamicConfig.getSync(key, fallback),
    );
  }

  private sessionType = InterviewProctorSessionType.CANDIDATE_INTERVIEW;

  async recordConsent(
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    const at = new Date();
    await patchSession({ consentRecordedAt: at });
    return { consent_recorded_at: at.toISOString() };
  }

  async verifyIdentity(
    row: InterviewSessionProctorRow,
    body: { descriptor: number[]; capture_quality?: number },
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    const global = await this.configRepo.getConfig();
    if (!Array.isArray(body.descriptor) || body.descriptor.length !== 128) {
      throw new BadRequestException('Face descriptor must be a 128-float vector');
    }

    const threshold = global.proctorFaceMatchThreshold ?? 0.55;
    const stored = row.referenceFaceDescriptor;

    if (stored?.length === 128) {
      const distance = euclideanDistance(stored, body.descriptor);
      if (distance > threshold) {
        await this.ingestEvents(row.candidateToken, [
          {
            type: 'identity_mismatch',
            severity: 'critical',
            payload: { distance, threshold, phase: 'consent' },
          },
        ], patchSession);
        throw new ForbiddenException(
          `Face does not match reference (distance ${distance.toFixed(3)} > ${threshold})`,
        );
      }
    } else {
      await patchSession({ referenceFaceDescriptor: body.descriptor });
    }

    const verifiedAt = new Date();
    await patchSession({ identityVerifiedAt: verifiedAt });
    return {
      verified: true,
      identity_verified_at: verifiedAt.toISOString(),
      capture_quality: body.capture_quality ?? null,
      threshold,
    };
  }

  async verifyLiveness(
    row: InterviewSessionProctorRow,
    body: {
      challenge_id: string;
      passed: boolean;
      motion_score?: number;
      steps_completed?: string[];
      vendor_session_id?: string;
    },
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    const global = await this.configRepo.getConfig();
    const provider = resolveLivenessProvider(global.livenessProvider);
    const result = provider.validate(body);
    if (!result.valid) {
      await this.ingestEvents(row.candidateToken, [
        {
          type: 'liveness_failed',
          severity: 'critical',
          payload: { reason: result.reason, provider: provider.name },
        },
      ], patchSession);
      throw new ForbiddenException(result.reason ?? 'Liveness verification failed');
    }

    const verifiedAt = new Date();
    await patchSession({
      livenessVerifiedAt: verifiedAt,
      livenessMethod: provider.name,
    });
    await this.ingestEvents(row.candidateToken, [
      {
        type: 'liveness_passed',
        severity: 'info',
        payload: {
          provider: provider.name,
          motion_score: body.motion_score,
          steps_completed: body.steps_completed,
        },
      },
    ], patchSession);

    return {
      verified: true,
      liveness_verified_at: verifiedAt.toISOString(),
      method: provider.name,
    };
  }

  async enrollVoice(
    row: InterviewSessionProctorRow,
    body: { audio_base64?: string; embedding?: number[] },
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    let embedding = body.embedding;
    if (!embedding?.length && body.audio_base64) {
      const samples = decodeBase64Pcm16(body.audio_base64);
      embedding = computeVoiceFingerprint(samples);
    }
    if (!embedding?.length) {
      throw new BadRequestException('Voice enrollment requires audio or embedding');
    }

    await patchSession({ voiceReferenceEmbedding: embedding });
    await this.ingestEvents(row.candidateToken, [
      {
        type: 'voice_enrolled',
        severity: 'info',
        payload: { dims: embedding.length },
      },
    ], patchSession);

    return { enrolled: true, dims: embedding.length };
  }

  async checkVoice(
    row: InterviewSessionProctorRow,
    body: { audio_base64?: string; embedding?: number[]; phase?: string },
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    const global = await this.configRepo.getConfig();
    const reference = row.voiceReferenceEmbedding;
    if (!reference?.length) {
      throw new BadRequestException('Voice reference not enrolled');
    }

    let sample = body.embedding;
    if (!sample?.length && body.audio_base64) {
      const samples = decodeBase64Pcm16(body.audio_base64);
      sample = computeVoiceFingerprint(samples);
    }
    if (!sample?.length) {
      throw new BadRequestException('Voice check requires audio or embedding');
    }

    const distance = voiceFingerprintDistance(reference, sample);
    const threshold = global.voiceDriftThreshold ?? 0.35;
    const match = distance <= threshold;

    if (!match) {
      await this.ingestEvents(row.candidateToken, [
        {
          type: 'voice_inconsistency',
          severity: 'critical',
          payload: {
            distance: Number(distance.toFixed(4)),
            threshold,
            phase: body.phase ?? 'oral',
          },
        },
      ], patchSession);
    }

    return { match, distance: Number(distance.toFixed(4)), threshold };
  }

  async ingestEvents(
    candidateToken: string,
    events: ProctorEventInput[],
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
    options?: { currentRoundType?: string | null },
  ) {
    if (!events.length) {
      return { ingested: 0, summary: null };
    }
    const roundType = options?.currentRoundType?.trim() || null;
    const tagged = events.map((event) => ({
      ...event,
      payload: {
        ...(event.payload ?? {}),
        ...(roundType && !(typeof event.payload?.round_type === 'string')
          ? { round_type: roundType }
          : {}),
      },
    }));
    const saved = await this.proctorRepo.insertBatch(candidateToken, this.sessionType, tagged);
    const summary = await this.proctorRepo.buildSummary(candidateToken, this.sessionType, {
      currentRoundType: options?.currentRoundType,
    });
    await patchSession({ proctorSummary: summary });
    return { ingested: saved.length, summary };
  }

  async evaluateVoiceTurn(
    candidateToken: string,
    meta: VoiceTurnTimingMeta,
    patchSession: (patch: Record<string, unknown>) => Promise<unknown>,
  ) {
    const global = await this.configRepo.getConfig();
    const history = this.turnHistory.get(candidateToken) ?? [];
    const wordCount = (meta.user_text ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (meta.turn_index != null && wordCount > 0) {
      history.push({
        turn_index: meta.turn_index,
        user_word_count: wordCount,
        reply_latency_ms: meta.reply_latency_ms,
      });
      if (history.length > 12) history.shift();
      this.turnHistory.set(candidateToken, history);
    }

    const events = evaluateRecruitmentFraudSignals(meta, history, {
      aiCheatPauseMs: global.aiCheatPauseMs,
      aiCheatMinWords: global.aiCheatMinWords,
    });

    if (events.length) {
      await this.ingestEvents(candidateToken, events, patchSession);
    }
    return events;
  }

  async getEventsForAudit(candidateToken: string) {
    const rows = await this.proctorRepo.listBySession(
      candidateToken,
      this.sessionType,
      2000,
    );
    return rows.map((row) => ({
      event_type: row.eventType,
      severity: String(row.severity),
      payload: (row.payload ?? undefined) as Record<string, unknown> | undefined,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async getProctorReportData(row: InterviewSessionProctorRow) {
    const events = await this.getEventsForAudit(row.candidateToken);
    const dynamicSummary = await this.proctorRepo.buildSummary(row.candidateToken, this.sessionType);
    const existingMeta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const cfg = this.strikeConfig();

    const summary: Record<string, unknown> = {
      ...dynamicSummary,
      ...existingMeta,
      media_strike_count: dynamicSummary.media_strike_count,
      focus_strike_count: dynamicSummary.focus_strike_count,
      current_round_strikes: dynamicSummary.current_round_strikes,
      by_type: dynamicSummary.by_type,
      total_events: dynamicSummary.total_events,
      critical_count: dynamicSummary.critical_count,
      warning_count: dynamicSummary.warning_count,
    };

    const hasFocusTerm = events.some((e) => e.event_type === 'focus_strike_terminated');
    const hasMediaTerm = events.some((e) => e.event_type === 'media_permission_terminated');

    if (!summary.terminated_by) {
      if (
        hasFocusTerm ||
        (cfg.enableFocusStrikes &&
          cfg.autoSubmitOnFocusStrike &&
          (dynamicSummary.focus_strike_count ?? 0) >= cfg.maxFocusStrikes)
      ) {
        summary.terminated_by = 'proctor';
        summary.termination_reason = 'max_focus_strikes_exceeded';
      } else if (
        hasMediaTerm ||
        (cfg.enableMediaStrikes &&
          cfg.autoSubmitOnMediaStrike &&
          (dynamicSummary.media_strike_count ?? 0) >= cfg.maxMediaStrikes)
      ) {
        summary.terminated_by = 'proctor';
        summary.termination_reason = 'max_media_strikes_exceeded';
      }
    }

    return {
      identity_verified_at: row.identityVerifiedAt?.toISOString() ?? null,
      liveness_verified_at: row.livenessVerifiedAt?.toISOString() ?? null,
      proctor_summary: summary,
      proctor_events: events,
    };
  }

  assertGateComplete(
    row: InterviewSessionProctorRow,
    requireCamera: boolean,
    requireVoice: boolean,
  ) {
    // BYPASSED AS REQUESTED BY USER
    return;
    
    // If both camera and voice are not required, skip all checks (preview/demo mode)
    // if (!requireCamera && !requireVoice) return;
    // if (!row.consentRecordedAt) {
    //   throw new BadRequestException('Consent required before starting the interview');
    // }
    // if (requireCamera && !row.identityVerifiedAt) {
    //   throw new BadRequestException('Identity verification required before starting');
    // }
    // if (requireCamera && !row.livenessVerifiedAt) {
    //   throw new BadRequestException('Liveness verification required before starting');
    // }
    // if (requireVoice && !row.voiceReferenceEmbedding?.length) {
    //   throw new BadRequestException('Voice enrollment required before starting');
    // }
  }
}
