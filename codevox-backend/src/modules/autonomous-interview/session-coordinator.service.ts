import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  AutonomousInterviewPhase,
  AutonomousInterviewDecision,
} from './entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRepository } from './autonomous-interview.repository';
import {
  AutonomousInterviewRoundsRepository,
  resolveRoundType,
  roomNameForRound,
} from './autonomous-interview-rounds.repository';
import {
  AutonomousInterviewRoundStatus,
  AutonomousInterviewRoundType,
} from './entities/autonomous-interview-round.mysql.entity';
import { LiveKitService } from './livekit.service';
import { InterviewRecordingService } from './interview-recording.service';
import { toRecordingPlaybackUrl } from './recording-playback';
import { VoiceEngineClient } from './voice-engine.client';
import { InterviewViewportHub } from './interview-viewport.hub';
import { WorkspaceService } from '../assessment-execution/workspace/workspace.service';
import { AssessmentExecutionService } from '../assessment-execution/assessment-execution.service';
import { ResumeSkillsResolver } from './resume-skills.resolver';
import { InterviewProctorService, InterviewSessionProctorRow } from '../proctor/interview-proctor.service';
import { InterviewGlobalConfigRepository } from '../proctor/interview-global-config.repository';
import { CandidateAutonomousInterviewMysql } from './entities/candidate-autonomous-interview.mysql.entity';
import type { ProctorEventInput } from '../proctor/proctor.types';
import { JobProfilePipelineService } from '../job-profiles/job-profile-pipeline.service';
import { JobProfilesRepository } from '../job-profiles/job-profiles.repository';
import { RoundSnapshotService } from '../assessment-reports/round-snapshot.service';
import {
  ScreeningAnalyzerService,
  type ScreeningVoiceAudit,
} from './screening-analyzer.service';
import { ProjectInterviewService } from '../project-interview/project-interview.service';

@Injectable()
export class SessionCoordinatorService {
  private readonly logger = new Logger(SessionCoordinatorService.name);

  constructor(
    private readonly repo: AutonomousInterviewRepository,
    private readonly rounds: AutonomousInterviewRoundsRepository,
    private readonly livekit: LiveKitService,
    private readonly voiceEngine: VoiceEngineClient,
    private readonly viewport: InterviewViewportHub,
    private readonly workspace: WorkspaceService,
    private readonly assessmentExecution: AssessmentExecutionService,
    private readonly resumeSkills: ResumeSkillsResolver,
    private readonly interviewProctor: InterviewProctorService,
    private readonly interviewConfig: InterviewGlobalConfigRepository,
    @Inject(forwardRef(() => JobProfilePipelineService))
    private readonly jobPipeline: JobProfilePipelineService,
    @Inject(forwardRef(() => JobProfilesRepository))
    private readonly jobProfilesRepo: JobProfilesRepository,
    private readonly screeningAnalyzer: ScreeningAnalyzerService,
    private readonly roundSnapshots: RoundSnapshotService,
    private readonly recordings: InterviewRecordingService,
    private readonly projectInterview: ProjectInterviewService,
  ) { }

  private proctorRow(row: CandidateAutonomousInterviewMysql): InterviewSessionProctorRow {
    return {
      candidateToken: row.candidateToken,
      consentRecordedAt: row.consentRecordedAt,
      identityVerifiedAt: row.identityVerifiedAt,
      referenceFaceDescriptor: row.referenceFaceDescriptor,
      livenessVerifiedAt: row.livenessVerifiedAt,
      voiceReferenceEmbedding: row.voiceReferenceEmbedding,
      proctorSummary: row.proctorSummary,
    };
  }

  private patchProctorSession(candidateToken: string) {
    return async (patch: Record<string, unknown>) => {
      if (patch.proctorSummary) {
        const row = await this.repo.findByToken(candidateToken);
        if (row && row.proctorSummary) {
          patch.proctorSummary = {
            ...(row.proctorSummary as object),
            ...(patch.proctorSummary as object),
          };
        }
      }
      await this.repo.patch(candidateToken, patch);
    };
  }

  async getProctorConfig() {
    const global = await this.interviewConfig.getConfig();
    return {
      consentText: global.consentText,
      proctorConfig: {
        faceCheckIntervalMs: global.proctorFaceCheckIntervalMs,
        faceMatchThreshold: global.proctorFaceMatchThreshold,
        requireCameraForStart: global.requireCameraForStart === 1,
        requireVoiceEnroll: global.requireVoiceEnroll === 1,
      },
      livenessProvider: global.livenessProvider,
    };
  }

  /**
   * Load the preceding Take-Home stage report for Technical / AI Verbal verification.
   * Maps Round Config include_take_home_verification → runtime take_home_verification_enabled.
   * Skips (does not crash) when submission/report is missing.
   */
  async recordConsent(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    return this.interviewProctor.recordConsent(this.patchProctorSession(candidateToken));
  }

  async verifyIdentity(
    candidateToken: string,
    body: { descriptor: number[]; capture_quality?: number },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    return this.interviewProctor.verifyIdentity(
      this.proctorRow(row),
      body,
      this.patchProctorSession(candidateToken),
    );
  }

  async verifyLiveness(
    candidateToken: string,
    body: {
      challenge_id: string;
      passed: boolean;
      motion_score?: number;
      steps_completed?: string[];
      vendor_session_id?: string;
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    return this.interviewProctor.verifyLiveness(
      this.proctorRow(row),
      body,
      this.patchProctorSession(candidateToken),
    );
  }

  async enrollVoice(
    candidateToken: string,
    body: { audio_base64?: string; embedding?: number[] },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    return this.interviewProctor.enrollVoice(
      this.proctorRow(row),
      body,
      this.patchProctorSession(candidateToken),
    );
  }

  async checkVoice(
    candidateToken: string,
    body: { audio_base64?: string; embedding?: number[]; phase?: string },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    return this.interviewProctor.checkVoice(
      this.proctorRow(row),
      body,
      this.patchProctorSession(candidateToken),
    );
  }

  async ingestProctorEvents(candidateToken: string, events: ProctorEventInput[]) {
    const row = await this.repo.requireByToken(candidateToken);
    const result = await this.interviewProctor.ingestEvents(
      candidateToken,
      events,
      this.patchProctorSession(candidateToken),
    );
    for (const event of events) {
      if (event.type === 'candidate_ended_interview') {
        await this.markCandidateVoluntaryExit(candidateToken);
      }
      if (event.severity === 'critical' || event.severity === 'warning') {
        this.viewport.emitProctorAlert(candidateToken, {
          eventType: event.type,
          severity: event.severity,
          message: String(event.payload?.message ?? event.type.replace(/_/g, ' ')),
        });
      }
    }
    return result;
  }

  /** Candidate confirmed End interview. Does not change round status. */
  private async markCandidateVoluntaryExit(candidateToken: string) {
    const row = await this.repo.findByToken(candidateToken);
    if (!row) return;
    const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    if (meta.bndPhase === 'build') return;
    if (meta.terminated_by === 'candidate' && meta.candidate_ended_at) return;
    await this.repo.patch(candidateToken, {
      proctorSummary: {
        ...meta,
        terminated_by: 'candidate',
        candidate_voluntary_exit: true,
        candidate_ended_at: meta.candidate_ended_at ?? new Date().toISOString(),
      },
    });
  }

  async getProctorEventsForAudit(candidateToken: string) {
    return this.interviewProctor.getEventsForAudit(candidateToken);
  }

  async getSession(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    const global = await this.interviewConfig.getConfig();
    const stage1History = (row.stage1ChatHistory as { role?: string; content?: string }[] | null) ?? [];
    const stage3History = (row.stage3ChatHistory as { role?: string; content?: string }[] | null) ?? [];
    // Behavioural / HR verbal persists to stage3; technical intro uses stage1
    const activeHistory =
      row.currentPhase === AutonomousInterviewPhase.HR_VERBAL ? stage3History : stage1History;
    const introAgentTurns = activeHistory.filter((m) => m.role === 'assistant').length;
    const introUserTurns = activeHistory.filter((m) => m.role === 'user').length;
    const introMinTurns = Number(process.env.INTRO_MIN_TURNS ?? 3);
    const introMaxTurns = Number(process.env.INTRO_MAX_TURNS ?? 50);
    const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const portalFromMeta =
      typeof meta.portalToken === 'string' && meta.portalToken.trim()
        ? meta.portalToken.trim()
        : null;
    const recordings = await this.recordings
      .listForApplication(portalFromMeta || row.candidateToken)
      .catch(() => []);
    const isBehavioral =
      !!(row.proctorSummary as { isBehavioral?: boolean } | null)?.isBehavioral ||
      row.currentPhase === AutonomousInterviewPhase.HR_VERBAL;
    return {
      recordings,
      candidateToken: row.candidateToken,
      currentPhase: row.currentPhase,
      /** Hint for candidate UI phase pill (technical vs behavioral engine). */
      voicePhase: row.currentPhase,
      engine: isBehavioral
        ? 'behavioral'
        : row.currentPhase === AutonomousInterviewPhase.AI_SCREENING
          ? 'screening'
          : 'technical',
      candidateAssessmentId: row.candidateAssessmentId,
      techStack: row.techStack,
      stage1VoiceScore: row.stage1VoiceScore,
      codeQualityScore: row.codeQualityScore,
      finalDecision: row.finalDecision,
      recordingUrl: await toRecordingPlaybackUrl(row.recordingUrl),
      isBehavioral,
      introAgentTurns,
      introUserTurns,
      introMinTurns,
      introMaxTurns,
      introChatHistory: activeHistory
        .filter((m) => m.role === 'assistant' || m.role === 'user')
        .map((m) => ({ role: m.role as string, content: String(m.content ?? '') })),
      consentText: global.consentText,
      consentRecordedAt: row.consentRecordedAt?.toISOString() ?? null,
      identityVerifiedAt: row.identityVerifiedAt?.toISOString() ?? null,
      livenessVerifiedAt: row.livenessVerifiedAt?.toISOString() ?? null,
      referenceFaceDescriptor:
        row.identityVerifiedAt && row.referenceFaceDescriptor?.length === 128
          ? row.referenceFaceDescriptor
          : null,
      voiceEnrolled: !!row.voiceReferenceEmbedding?.length,
      proctorConfig: {
        faceCheckIntervalMs: global.proctorFaceCheckIntervalMs,
        faceMatchThreshold: global.proctorFaceMatchThreshold,
        // For preview/demo sessions, disable all proctoring checks
        requireCameraForStart: row.isPreview !== 1 && global.requireCameraForStart === 1,
        requireVoiceEnroll: row.isPreview !== 1 && global.requireVoiceEnroll === 1,
      },
      livenessProvider: global.livenessProvider,
      proctorSummary: row.proctorSummary,
    };
  }

  async initializeSession(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    if (row.currentPhase === AutonomousInterviewPhase.COMPLETED) {
      throw new BadRequestException('Interview already completed');
    }

    const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const roundType = resolveRoundType({
      currentPhase: row.currentPhase,
      stageType: typeof meta.stageType === 'string' ? meta.stageType : null,
    });
    const roomName = roomNameForRound(candidateToken, roundType);
    await this.rounds.ensureRound(candidateToken, roundType, { livekitRoomName: roomName });
    await this.repo.saveRoom(candidateToken, roomName);
    void this.livekit.ensureRoomMetadata(roomName, {
      session_type: 'candidate_interview',
      candidate_token: candidateToken,
      round_type: roundType,
      tech_stack: row.techStack?.trim() || '',
    });

    const { token: livekitToken, url: livekitUrl } =
      await this.livekit.createParticipantToken({
        roomName,
        identity: `candidate-${candidateToken}`,
        name: 'Candidate',
      });

    const phase =
      row.currentPhase === AutonomousInterviewPhase.BND_INTERVIEW
        ? 'bnd_interview'
        : row.currentPhase === AutonomousInterviewPhase.BND_ASSESSMENT
          ? 'bnd_assessment'
          : row.currentPhase === AutonomousInterviewPhase.AI_SCREENING
            ? 'ai_screening'
            : row.currentPhase === AutonomousInterviewPhase.HR_VERBAL
              ? 'hr_verbal'
              : 'ai_verbal';

    return {
      candidateToken,
      currentPhase: row.currentPhase,
      livekitToken,
      livekitUrl,
      roomName,
      candidateAssessmentId: row.candidateAssessmentId,
      voicePhase: phase,
      roundType,
    };
  }

  async startVoiceAgent(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    if (row.currentPhase === AutonomousInterviewPhase.COMPLETED) {
      return { started: false, reason: 'completed' };
    }
    if (
      row.currentPhase === AutonomousInterviewPhase.SANDBOX_CODE ||
      row.currentPhase === AutonomousInterviewPhase.CLOSING
    ) {
      return { started: false, reason: 'unified_agent_active' };
    }

    const { skills: resumeSkills, candidateName, projectsSummary, experienceSummary } =
      await this.resumeSkills.resolveForInterview(row);

    let jobProfileContext: Record<string, unknown> | undefined;
    if (projectsSummary || experienceSummary) {
      jobProfileContext = {
        resume_projects: projectsSummary,
        resume_experience: experienceSummary,
      };
    }

    let rubricCriteria: Array<{
      id: string;
      label: string;
      description?: string | null;
      max_marks: number;
      target_score: number;
      weight_pct: number;
      category?: string;
      question_plan?: Record<string, unknown> | null;
    }> | undefined;

    let engine: 'technical' | 'behavioral' | 'screening' | 'bnd_build' = 'technical';
    let voicePhase: 'ai_verbal' | 'hr_verbal' | 'ai_screening' | 'bnd_assessment' | 'bnd_interview' =
      'ai_verbal';
    let roundConfig: Record<string, unknown> | undefined;
    let projectInterviewPayload: Record<string, unknown> | null = null;
    let projectBuildPayload: Record<string, unknown> | null = null;
    /** Merged screening→verbal must stay on one LiveKit room (intro_verbal). */
    let mergeScreeningVerbal = false;

    if (row.jobProfileId) {
      const profile = await this.jobProfilesRepo.findById(row.jobProfileId);
      if (profile) {
        jobProfileContext = jobProfileContext || {};
        jobProfileContext.title = profile.title;
        jobProfileContext.department = profile.department ?? null;
        jobProfileContext.seniority_level = profile.seniorityLevel;
        jobProfileContext.responsibilities = profile.responsibilities ?? [];
        jobProfileContext.required_skills = profile.requiredSkills ?? [];
        jobProfileContext.nice_to_have_skills = profile.niceToHaveSkills ?? [];

        if (profile.candidateFaq?.length) {
          jobProfileContext.faq = profile.candidateFaq;
        } else if (profile.autonomousInterviewConfig?.candidate_faq) {
          jobProfileContext.faq = profile.autonomousInterviewConfig.candidate_faq;
        }

        const allCompetencies = await this.jobProfilesRepo.listCompetencies(row.jobProfileId);
        const stages = await this.jobProfilesRepo.listStages(row.jobProfileId);

        // Prefer explicit phase: HR_VERBAL session → behavioural; else technical ai_verbal
        const technicalStage = stages.find((s) => s.stageType === 'ai_verbal');
        const proctorMeta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
        const portalToken =
          typeof proctorMeta.portalToken === 'string' ? proctorMeta.portalToken : undefined;
        const proctorStageId =
          proctorMeta.stageId != null ? String(proctorMeta.stageId) : undefined;

        // Application is keyed by portal token, not the LiveKit ses_… session token.
        const application = await this.jobProfilesRepo.findApplicationByToken(
          portalToken || candidateToken,
        );
        const appStage = application?.currentStageId
          ? stages.find((s) => String(s.id) === String(application.currentStageId))
          : undefined;
        const proctorStage = proctorStageId
          ? stages.find((s) => String(s.id) === proctorStageId)
          : undefined;

        const isScreeningStage = (s?: any) =>
          s && (s.stageType === 'ai_screening' || /screen/i.test(s.name || ''));

        const screeningStage =
          (isScreeningStage(proctorStage) ? proctorStage : undefined) ??
          stages.find((s) => isScreeningStage(s));

        const interviewStageForMerge =
          (proctorStage?.stageType === 'ai_verbal' ? proctorStage : undefined) ??
          technicalStage ??
          stages.find((s) => s.stageType === 'ai_verbal');
        const mergeCfg =
          (interviewStageForMerge?.roundConfig as Record<string, unknown> | null) ?? {};
        mergeScreeningVerbal = Boolean(mergeCfg.merge_screening_verbal);

        const useScreening =
          !mergeScreeningVerbal &&
          (row.currentPhase === AutonomousInterviewPhase.AI_SCREENING ||
            isScreeningStage(proctorStage) ||
            isScreeningStage(appStage));

        // Merged screening→verbal: one agent process with engine=technical +
        // round_config.merge_screening_verbal. voice_agent runs screening then verbal
        // in the same LiveKit room. If already INTRO_VERBAL, skip screening (reconnect).
        if (mergeScreeningVerbal && interviewStageForMerge) {
          engine = 'technical';
          roundConfig = { ...mergeCfg };
          if (row.currentPhase === AutonomousInterviewPhase.INTRO_VERBAL) {
            voicePhase = 'ai_verbal';
            roundConfig = { ...roundConfig, merge_screening_verbal: false };
          } else {
            voicePhase = 'ai_screening';
            if (row.currentPhase !== AutonomousInterviewPhase.AI_SCREENING) {
              await this.repo.patch(candidateToken, {
                currentPhase: AutonomousInterviewPhase.AI_SCREENING,
              });
              row.currentPhase = AutonomousInterviewPhase.AI_SCREENING;
            }
          }
          if (allCompetencies.length > 0) {
            const uniqueCompetencies = new Map<string, (typeof allCompetencies)[0]>();
            for (const c of allCompetencies) {
              if (String(c.stageId) !== String(interviewStageForMerge.id)) continue;
              uniqueCompetencies.set(c.name.toLowerCase(), c);
            }
            rubricCriteria = Array.from(uniqueCompetencies.values()).map((c) => ({
              id: c.id,
              label: c.name,
              description: null,
              max_marks: 10,
              target_score: parseFloat(c.targetScore ?? '8'),
              weight_pct: parseFloat(c.weightPct ?? '0'),
              question_plan: c.questionPlan ?? null,
            }));
          }
        } else if (useScreening && screeningStage) {
          engine = 'screening';
          voicePhase = 'ai_screening';
          roundConfig = (screeningStage.roundConfig as Record<string, unknown>) ?? {};
          rubricCriteria = undefined;
        } else if (proctorStage?.stageType === 'project_interview') {
          const bndPhase =
            proctorMeta.bndPhase === 'build' ||
            row.currentPhase === AutonomousInterviewPhase.BND_ASSESSMENT
              ? 'build'
              : 'defend';
          roundConfig = (proctorStage.roundConfig as Record<string, unknown>) ?? {};
          if (bndPhase === 'build') {
            engine = 'bnd_build';
            voicePhase = 'bnd_assessment';
            if (row.currentPhase !== AutonomousInterviewPhase.BND_ASSESSMENT) {
              await this.repo.patch(candidateToken, {
                currentPhase: AutonomousInterviewPhase.BND_ASSESSMENT,
              });
              row.currentPhase = AutonomousInterviewPhase.BND_ASSESSMENT;
            }
            rubricCriteria = undefined;
            projectBuildPayload = await this.projectInterview.buildBuildPhasePayload(candidateToken);
            this.logger.log(
              `Build & Defend Build started token=${candidateToken} payload=${projectBuildPayload ? 'yes' : 'missing'}`,
            );
          } else {
            engine = 'technical';
            voicePhase = 'bnd_interview';
            if (row.currentPhase !== AutonomousInterviewPhase.BND_INTERVIEW) {
              await this.repo.patch(candidateToken, {
                currentPhase: AutonomousInterviewPhase.BND_INTERVIEW,
              });
              row.currentPhase = AutonomousInterviewPhase.BND_INTERVIEW;
            }
            rubricCriteria = allCompetencies
              .filter((c) => String(c.stageId) === String(proctorStage.id))
              .map((c) => ({
                id: c.id,
                label: c.name,
                description: null,
                max_marks: 10,
                target_score: parseFloat(c.targetScore ?? '8'),
                weight_pct: parseFloat(c.weightPct ?? '0'),
              }));
            projectInterviewPayload = await this.projectInterview.buildVoicePayload(candidateToken);
            this.logger.log(
              `Build & Defend interview started token=${candidateToken} project_payload=${projectInterviewPayload ? 'yes' : 'missing'}`,
            );
          }
        } else {
          const useBehavioural =
            row.currentPhase === AutonomousInterviewPhase.HR_VERBAL ||
            !!proctorMeta.isBehavioral ||
            (proctorStage != null &&
              proctorStage.stageType === 'hr_verbal' &&
              String(proctorStage.mode ?? '') === 'ai_led');

          if (useBehavioural) {
            engine = 'behavioral';
            voicePhase = 'hr_verbal';
            // Align DB phase so viewport / reconnect stay on behavioural
            if (row.currentPhase !== AutonomousInterviewPhase.HR_VERBAL) {
              await this.repo.patch(candidateToken, {
                currentPhase: AutonomousInterviewPhase.HR_VERBAL,
              });
              row.currentPhase = AutonomousInterviewPhase.HR_VERBAL;
            }
            roundConfig = (proctorStage?.roundConfig as Record<string, unknown>) ?? {};
            const stageIdForComps = proctorStage?.id ?? appStage?.id;
            const stageComps = allCompetencies.filter(
              (c) =>
                (stageIdForComps
                  ? String(c.stageId) === String(stageIdForComps)
                  : true) &&
                (c.category === 'soft' || !c.category),
            );
            const pool = stageComps.length
              ? stageComps
              : allCompetencies.filter((c) =>
                  stageIdForComps
                    ? String(c.stageId) === String(stageIdForComps)
                    : true,
                );
            rubricCriteria = pool.map((c) => ({
              id: c.id,
              label: c.name,
              description: null,
              max_marks: 10,
              target_score: parseFloat(c.targetScore ?? '8'),
              weight_pct: parseFloat(c.weightPct ?? '0'),
              category: c.category,
            }));
          } else {
            const interviewStage =
              (proctorStage?.stageType === 'ai_verbal' ? proctorStage : undefined) ??
              technicalStage ??
              stages.find((s) => s.stageType === 'ai_verbal');
            roundConfig = (interviewStage?.roundConfig as Record<string, unknown>) ?? {};
            if (allCompetencies.length > 0) {
              const uniqueCompetencies = new Map<string, (typeof allCompetencies)[0]>();
              for (const c of allCompetencies) {
                if (interviewStage && String(c.stageId) !== String(interviewStage.id)) {
                  continue;
                }
                uniqueCompetencies.set(c.name.toLowerCase(), c);
              }
              rubricCriteria = Array.from(uniqueCompetencies.values()).map((c) => ({
                id: c.id,
                label: c.name,
                description: null,
                max_marks: 10,
                target_score: parseFloat(c.targetScore ?? '8'),
                weight_pct: parseFloat(c.weightPct ?? '0'),
                question_plan: c.questionPlan ?? null,
              }));
            }


          }
        }
      }
    }

    const recordingMeta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const portalTokenForApp =
      typeof recordingMeta.portalToken === 'string' && recordingMeta.portalToken.trim()
        ? recordingMeta.portalToken.trim()
        : candidateToken;
    const applicationForRecording = await this.jobProfilesRepo
      .findApplicationByToken(portalTokenForApp)
      .catch(() => null);
    const candidateIdForRecording =
      applicationForRecording?.id != null
        ? String(applicationForRecording.id)
        : typeof recordingMeta.applicationId === 'string'
          ? recordingMeta.applicationId
          : typeof recordingMeta.applicationId === 'number'
            ? String(recordingMeta.applicationId)
            : null;

    // Merge path: keep intro_verbal room even while currentPhase/voicePhase are ai_screening,
    // so screening handoff → verbal rejoins the same LiveKit room the candidate already joined.
    const roundType = mergeScreeningVerbal
      ? AutonomousInterviewRoundType.INTRO_VERBAL
      : resolveRoundType({
          voicePhase,
          engine,
          stageType: typeof recordingMeta.stageType === 'string' ? recordingMeta.stageType : null,
          currentPhase: row.currentPhase,
        });
    const roomName = roomNameForRound(candidateToken, roundType);
    const roundRow = await this.rounds.ensureRound(candidateToken, roundType, {
      livekitRoomName: roomName,
    });
    await this.repo.saveRoom(candidateToken, roomName);
    void this.livekit.ensureRoomMetadata(roomName, {
      session_type: 'candidate_interview',
      candidate_token: candidateToken,
      round_type: roundType,
      tech_stack: row.techStack?.trim() || '',
    });

    const payload = {
      token: candidateToken,
      room_name: roomName,
      phase: voicePhase,
      engine,
      round_type: roundType,
      tech_stack: row.techStack,
      resume_skills: resumeSkills,
      candidate_name: candidateName,
      candidate_id: candidateIdForRecording ?? undefined,
      application_id: candidateIdForRecording ?? undefined,
      job_profile_context: jobProfileContext,
      rubric_criteria: rubricCriteria,
      round_config: roundConfig,
      take_home_verification_enabled: false,
      take_home_weight_pct: 0,
      take_home_payload: null,
      project_interview_payload: engine === 'technical' ? projectInterviewPayload : null,
      project_build_payload: engine === 'bnd_build' ? projectBuildPayload : null,
      language_preference:
        applicationForRecording?.interviewLanguage === 'hi' ? 'hi-IN' : 'en-IN',
    };

    void this.voiceEngine.startAgent(payload);

    try {
      await this.recordings.start(candidateToken, roomName, {
        engine,
        stageId: roundType,
        portalToken:
          typeof recordingMeta.portalToken === 'string' ? recordingMeta.portalToken : null,
        roundType,
      });
    } catch (err) {
      this.logger.warn(
        `Recording start failed token=${candidateToken}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      started: true,
      roomName: roundRow.livekitRoomName ?? roomName,
      phase: voicePhase,
      engine,
      roundType,
    };
  }

  async getViewportHydration(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    const phase = row.currentPhase;
    let payload: Record<string, unknown> | undefined;

    if (phase === AutonomousInterviewPhase.SANDBOX_CODE && row.candidateAssessmentId) {
      try {
        const attempt = await this.assessmentExecution.getAttempt(row.candidateAssessmentId);
        payload = {
          candidateAssessmentId: row.candidateAssessmentId,
          attempt,
        };
      } catch (err) {
        this.logger.warn(
          `Could not hydrate sandbox attempt ${row.candidateAssessmentId}: ${err instanceof Error ? err.message : err}`,
        );
        payload = { candidateAssessmentId: row.candidateAssessmentId };
      }
    } else if (phase === AutonomousInterviewPhase.CLOSING) {
      payload = {
        candidateAssessmentId: row.candidateAssessmentId,
        codeQualityScore: row.codeQualityScore,
        architecturalFlaws: row.architecturalFlaws,
      };
    }

    return { phase, payload };
  }

  async candidateReady(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    const global = await this.interviewConfig.getConfig();
    // Skip strict proctor gate for preview/demo sessions
    const isPreview = row.isPreview === 1;
    this.interviewProctor.assertGateComplete(
      this.proctorRow(row),
      !isPreview && global.requireCameraForStart === 1,
      !isPreview && global.requireVoiceEnroll === 1,
    );
    const session = await this.initializeSession(candidateToken);
    const agent = await this.startVoiceAgent(candidateToken);
    return {
      started: agent.started,
      rejoin:
        !agent.started &&
        (row.currentPhase === AutonomousInterviewPhase.SANDBOX_CODE ||
          row.currentPhase === AutonomousInterviewPhase.CLOSING),
      currentPhase: row.currentPhase,
      mode: 'livekit' as const,
      livekitToken: session.livekitToken,
      livekitUrl: session.livekitUrl,
      roomName: session.roomName,
      phase: session.voicePhase,
    };
  }

  async processVoiceMessage(candidateToken: string, message = '') {
    const row = await this.repo.requireByToken(candidateToken);
    if (
      row.currentPhase !== AutonomousInterviewPhase.INTRO_VERBAL &&
      row.currentPhase !== AutonomousInterviewPhase.HR_VERBAL &&
      row.currentPhase !== AutonomousInterviewPhase.AI_SCREENING
    ) {
      throw new BadRequestException('Interview is not in a voice phase');
    }

    const phase =
      row.currentPhase === AutonomousInterviewPhase.HR_VERBAL
        ? 'hr_verbal'
        : row.currentPhase === AutonomousInterviewPhase.AI_SCREENING
          ? 'ai_screening'
          : 'intro_verbal';

    const existingHistory =
      phase === 'hr_verbal'
        ? ((row.stage3ChatHistory as Record<string, unknown>[] | null) ?? [])
        : ((row.stage1ChatHistory as Record<string, unknown>[] | null) ?? []);

    const result = await this.voiceEngine.chatTurn({
      tech_stack: row.techStack?.trim() || 'the role',
      phase,
      message,
      chat_history: existingHistory,
      resume_skills: row.resumeSkills,
    });

    if (phase === 'ai_screening') {
      await this.repo.patch(candidateToken, {
        stage1ChatHistory: result.chat_history,
      });
      return {
        reply: result.reply,
        complete: result.complete,
        agentTurns: result.agent_turns,
        userTurns: result.user_turns,
        minTurns: result.min_turns,
        maxTurns: result.max_turns,
        currentPhase: row.currentPhase,
      };
    }

    if (phase === 'hr_verbal') {
      await this.repo.patch(candidateToken, {
        stage3ChatHistory: result.chat_history,
      });
      // Do not call completeInterview here without hr_voice_audit — that marked
      // every verbal round "completed" with no score. LiveKit behavioural finish
      // posts the full audit via /complete instead.
      return {
        reply: result.reply,
        complete: result.complete,
        agentTurns: result.agent_turns,
        userTurns: result.user_turns,
        minTurns: result.min_turns,
        maxTurns: result.max_turns,
        currentPhase: row.currentPhase,
      };
    }

    await this.repo.patch(candidateToken, {
      stage1ChatHistory: result.chat_history,
      ...(result.complete ? { stage1VoiceScore: result.depth_score } : {}),
    });

    if (result.complete) {
      // HACK: Bypass Sandbox Phase as requested by user
      // const autoSandbox = process.env.AUTONOMOUS_AUTO_SANDBOX === 'true';
      // if (autoSandbox) {
      //   const shifted = await this.transitionToSandbox(candidateToken, {
      //     stage1_voice_score: result.depth_score,
      //     stage1_chat_history: result.chat_history,
      //   });
      //   return {
      //     reply: result.reply,
      //     complete: true,
      //     agentTurns: result.agent_turns,
      //     userTurns: result.user_turns,
      //     minTurns: result.min_turns,
      //     maxTurns: result.max_turns,
      //     currentPhase: AutonomousInterviewPhase.SANDBOX_CODE,
      //     shifted,
      //   };
      // }

      // Complete the interview automatically since we are skipping the sandbox
      const shifted = await this.completeInterview(candidateToken, {
        stage1_voice_score: result.depth_score,
        stage1_chat_history: result.chat_history,
      });

      return {
        reply: result.reply,
        complete: true,
        agentTurns: result.agent_turns,
        userTurns: result.user_turns,
        minTurns: result.min_turns,
        maxTurns: result.max_turns,
        currentPhase: AutonomousInterviewPhase.COMPLETED,
        voiceIntroComplete: true,
        shifted,
      };
    }

    // Leftover return block removed

    return {
      reply: result.reply,
      complete: false,
      agentTurns: result.agent_turns,
      userTurns: result.user_turns,
      minTurns: result.min_turns,
      maxTurns: result.max_turns,
      currentPhase: row.currentPhase,
    };
  }

  async syncVoiceChat(
    candidateToken: string,
    chatHistory: Record<string, unknown>[],
    phase: 'ai_verbal' | 'hr_verbal' | 'unified' | 'bnd_interview' | 'ai_screening' | string,
    meta?: {
      turn_index?: number;
      reply_latency_ms?: number;
      stt_confidence?: number;
      speech_start_delay_ms?: number;
      utterance_duration_ms?: number;
      user_text?: string;
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    const voicePhase =
      row.currentPhase === AutonomousInterviewPhase.BND_INTERVIEW || phase === 'bnd_interview'
        ? 'bnd_interview'
        : row.currentPhase === AutonomousInterviewPhase.AI_SCREENING || phase === 'ai_screening'
          ? 'ai_screening'
          : phase === 'hr_verbal'
            ? 'hr_verbal'
            : 'ai_verbal';
    if (voicePhase === 'hr_verbal') {
      // Persist on both columns so getSession / viewport hydration stay consistent.
      await this.repo.patch(candidateToken, {
        stage3ChatHistory: chatHistory,
        stage1ChatHistory: chatHistory,
      });
    } else {
      await this.repo.patch(candidateToken, { stage1ChatHistory: chatHistory });
    }

    if (meta?.user_text?.trim()) {
      const fraudEvents = await this.interviewProctor.evaluateVoiceTurn(
        candidateToken,
        {
          turn_index: meta.turn_index,
          reply_latency_ms: meta.reply_latency_ms,
          stt_confidence: meta.stt_confidence,
          speech_start_delay_ms: meta.speech_start_delay_ms,
          utterance_duration_ms: meta.utterance_duration_ms,
          user_text: meta.user_text,
        },
        this.patchProctorSession(candidateToken),
      );
      for (const event of fraudEvents) {
        if (event.severity === 'critical' || event.severity === 'warning') {
          this.viewport.emitProctorAlert(candidateToken, {
            eventType: event.type,
            severity: event.severity,
          });
        }
      }
    }

    const normalized = chatHistory
      .filter((m) => m.role === 'assistant' || m.role === 'user')
      .map((m) => ({
        role: String(m.role),
        content: String(m.content ?? ''),
      }));

    this.viewport.emitChatUpdate(candidateToken, {
      chatHistory: normalized,
      phase: voicePhase,
      currentPhase: row.currentPhase,
    });

    return { chatHistory: normalized, phase: voicePhase };
  }

  async saveIntroResults(
    candidateToken: string,
    meta?: {
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    if (
      meta?.stage1_voice_score !== undefined ||
      meta?.stage1_chat_history ||
      meta?.stage1_voice_audit
    ) {
      await this.repo.patch(candidateToken, {
        ...(meta.stage1_voice_score !== undefined
          ? { stage1VoiceScore: meta.stage1_voice_score }
          : {}),
        ...(meta.stage1_chat_history
          ? { stage1ChatHistory: meta.stage1_chat_history }
          : {}),
        ...(meta.stage1_voice_audit
          ? { stage1VoiceAudit: meta.stage1_voice_audit }
          : {}),
      });
    }
    this.viewport.emitChatUpdate(candidateToken, {
      chatHistory:
        (meta?.stage1_chat_history as { role: string; content: string }[] | undefined)?.filter(
          (m) => m.role === 'assistant' || m.role === 'user',
        ) ?? [],
      phase: AutonomousInterviewPhase.INTRO_VERBAL,
      currentPhase: row.currentPhase,
      subPhase: 'pre_assessment',
    });
    return this.getSession(candidateToken);
  }

  async notifyScreenShareReady(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    this.viewport.emitChatUpdate(candidateToken, {
      chatHistory: [],
      phase: AutonomousInterviewPhase.INTRO_VERBAL,
      currentPhase: row.currentPhase,
      subPhase: 'screen_share_ready',
    });
    return this.getSession(candidateToken);
  }

  async transitionToAssessmentActive(
    candidateToken: string,
    meta?: {
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
    },
  ) {
    return this.transitionToSandbox(candidateToken, meta);
  }

  async transitionToSandbox(
    candidateToken: string,
    meta?: {
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);

    if (
      meta?.stage1_voice_score !== undefined ||
      meta?.stage1_chat_history ||
      meta?.stage1_voice_audit
    ) {
      await this.repo.patch(candidateToken, {
        ...(meta.stage1_voice_score !== undefined
          ? { stage1VoiceScore: meta.stage1_voice_score }
          : {}),
        ...(meta.stage1_chat_history
          ? { stage1ChatHistory: meta.stage1_chat_history }
          : {}),
        ...(meta.stage1_voice_audit
          ? { stage1VoiceAudit: meta.stage1_voice_audit }
          : {}),
      });
    }

    await this.repo.updatePhase(candidateToken, AutonomousInterviewPhase.SANDBOX_CODE);

    let attemptPayload: Record<string, unknown> | undefined;
    if (row.candidateAssessmentId) {
      try {
        attemptPayload = (await this.assessmentExecution.getAttempt(
          row.candidateAssessmentId,
        )) as Record<string, unknown>;
      } catch (err) {
        this.logger.warn(
          `Could not load attempt ${row.candidateAssessmentId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.viewport.emitViewportShift(candidateToken, AutonomousInterviewPhase.SANDBOX_CODE, {
      candidateAssessmentId: row.candidateAssessmentId,
      attempt: attemptPayload,
    });

    return {
      candidateToken,
      currentPhase: AutonomousInterviewPhase.SANDBOX_CODE,
      candidateAssessmentId: row.candidateAssessmentId,
      attempt: attemptPayload,
    };
  }

  async finalizeAssessmentSubmission(
    candidateToken: string,
    sourceCode: string,
    language?: string,
  ) {
    const row = await this.repo.requireByToken(candidateToken);

    if (row.candidateAssessmentId) {
      try {
        await this.workspace.teardown(row.candidateAssessmentId);
      } catch (err) {
        this.logger.warn(
          `Workspace teardown failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const analysis = await this.voiceEngine.analyzeSubmission({
      token: candidateToken,
      source_code: sourceCode,
      language,
    });

    await this.repo.patch(candidateToken, {
      submittedCode: sourceCode,
      codeQualityScore: analysis.code_quality_score,
      architecturalFlaws: analysis.architectural_flaws,
      currentPhase: AutonomousInterviewPhase.CLOSING,
    });

    this.viewport.emitViewportShift(candidateToken, AutonomousInterviewPhase.CLOSING, {
      codeQualityScore: analysis.code_quality_score,
      architecturalFlaws: analysis.architectural_flaws,
    });

    return {
      candidateToken,
      currentPhase: AutonomousInterviewPhase.CLOSING,
      codeQualityScore: analysis.code_quality_score,
      architecturalFlaws: analysis.architectural_flaws,
    };
  }

  /** Defend thank-you has finished. Open the assessing page before scoring. */
  async beginDefendAssessment(candidateToken: string) {
    const row = await this.projectInterview.markFinalEvaluationPending(candidateToken);
    if (!row) return { started: false as const };
    this.viewport.emitViewportShift(candidateToken, 'assessing', {
      submissionToken: row.submissionToken,
      portalToken: row.portalToken,
      stageType: 'project_interview',
    });
    return {
      started: true as const,
      submissionToken: row.submissionToken,
      portalToken: row.portalToken,
    };
  }

  /** @deprecated Use finalizeAssessmentSubmission — HR verbal reconnect removed */
  async transitionToHRReview(candidateToken: string, sourceCode: string, language?: string) {
    return this.finalizeAssessmentSubmission(candidateToken, sourceCode, language);
  }

  async completeInterview(
    candidateToken: string,
    body: {
      stage1_voice_score?: number;
      stage1_chat_history?: Record<string, unknown>[];
      stage1_voice_audit?: Record<string, unknown>;
      stage3_chat_history?: Record<string, unknown>[];
      hr_voice_audit?: Record<string, unknown>;
      final_decision?: AutonomousInterviewDecision;
      ended_by?: 'candidate';
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    const candidateEnded = body.ended_by === 'candidate';

    // Prevent double-completion skipping a stage. Still record a late exit flag.
    if (row.currentPhase === AutonomousInterviewPhase.COMPLETED) {
      if (candidateEnded) await this.markCandidateVoluntaryExit(candidateToken);
      return this.getSession(candidateToken);
    }
    
    const behaviouralScore =
      body.hr_voice_audit &&
      typeof (body.hr_voice_audit as { weighted_competency_score?: number }).weighted_competency_score ===
        'number'
        ? Number((body.hr_voice_audit as { weighted_competency_score: number }).weighted_competency_score) *
          20
        : null;
    
    const portalToken = (row.proctorSummary as any)?.portalToken;
    const threshold = await this.jobPipeline.resolveThresholdForInterview({
      jobProfileId: row.jobProfileId,
      candidateToken: portalToken || candidateToken,
      voiceScore:
        behaviouralScore ?? body.stage1_voice_score ?? row.stage1VoiceScore ?? null,
      codeScore: row.codeQualityScore != null ? Number(row.codeQualityScore) : null,
      finalDecision: body.final_decision,
    });

    const platformFromAudit =
      body.hr_voice_audit &&
      typeof (body.hr_voice_audit as { platform_decision?: string }).platform_decision ===
        'string'
        ? String((body.hr_voice_audit as { platform_decision: string }).platform_decision)
        : undefined;

    const behaviouralDecision =
      body.final_decision ??
      (platformFromAudit &&
      Object.values(AutonomousInterviewDecision).includes(
        platformFromAudit as AutonomousInterviewDecision,
      )
        ? (platformFromAudit as AutonomousInterviewDecision)
        : undefined);

    const finalDecision =
      behaviouralDecision ??
      (threshold.pending_human_review
        ? AutonomousInterviewDecision.UNDER_REVIEW
        : body.final_decision ?? threshold.final_decision);

    await this.repo.patch(candidateToken, {
      currentPhase: AutonomousInterviewPhase.COMPLETED,
      stage1VoiceScore:
        body.stage1_voice_score ??
        (behaviouralScore != null ? Math.round(behaviouralScore) : undefined),
      stage1ChatHistory: body.stage1_chat_history ?? undefined,
      stage1VoiceAudit: body.stage1_voice_audit ?? undefined,
      stage3ChatHistory: body.stage3_chat_history ?? undefined,
      hrVoiceAudit: body.hr_voice_audit ?? undefined,
      finalDecision,
    });
    if (candidateEnded) await this.markCandidateVoluntaryExit(candidateToken);

    const proctorStageType = (row.proctorSummary as Record<string, unknown> | null)?.stageType;
    if (proctorStageType === 'ai_verbal') {
      await this.rounds.patchRound(candidateToken, AutonomousInterviewRoundType.INTRO_VERBAL, {
        status: AutonomousInterviewRoundStatus.COMPLETED,
        ...(typeof body.stage1_voice_score === 'number' ? { aiScore: body.stage1_voice_score } : {}),
      });
    }
    if (
      proctorStageType === 'project_interview' &&
      (row.proctorSummary as Record<string, unknown> | null)?.bndPhase !== 'build'
    ) {
      await this.rounds.patchRound(candidateToken, AutonomousInterviewRoundType.BND_INTERVIEW, {
        status: AutonomousInterviewRoundStatus.COMPLETED,
        ...(typeof body.stage1_voice_score === 'number' ? { aiScore: body.stage1_voice_score } : {}),
      });
    }
    
    void this.roundSnapshots.upsertFromInterviewToken(candidateToken, portalToken);
    const projectSubmission =
      proctorStageType === 'project_interview'
        ? await this.projectInterview.findByAnySessionToken(candidateToken)
        : null;
    if (projectSubmission) {
      await this.projectInterview.markCompletedByInterviewToken(candidateToken);
    }

    let roundScoreForResult: number | null = null;
    if (row.jobProfileId) {
      // Normalize score to 0-100 for finishRound elimination gate.
      // behaviouralScore is already 0-100 (weighted_competency_score * 20).
      // stage1_voice_score is on a 0-10 scale, so multiply by 10.
      let roundScore =
        behaviouralScore ??
        (body.stage1_voice_score != null
          ? body.stage1_voice_score * 10
          : row.stage1VoiceScore != null
          ? Number(row.stage1VoiceScore) * 10
          : null) ??
        0;

      if (projectSubmission) {
        const summary = await this.projectInterview.getReportSummary(
          String(projectSubmission.jobApplicationId),
          String(projectSubmission.stageId),
        );
        if (summary?.final_combined_score_pct != null) {
          roundScore = summary.final_combined_score_pct;
        }
      }
      roundScoreForResult = roundScore;

      // finishRound() checks progressionConfig elimination threshold AND advances
      // the pipeline — same unified gate used by coding + take-home rounds.
      const finished = await this.jobPipeline.finishRound(portalToken || candidateToken, {
        score: roundScore,
        voiceScore: body.stage1_voice_score ?? row.stage1VoiceScore ?? undefined,
      });
      if (projectSubmission) {
        await this.projectInterview.saveCandidateResult(candidateToken, {
          scorePct: roundScore,
          outcome: finished.outcome,
        });
      }
    }

    this.viewport.emitViewportShift(candidateToken, AutonomousInterviewPhase.COMPLETED, {
      finalDecision,
      pending_human_review: threshold.pending_human_review,
      auto_action: threshold.auto_action,
      submissionToken: projectSubmission?.submissionToken ?? null,
      portalToken: projectSubmission?.portalToken ?? portalToken ?? null,
      stageType: proctorStageType ?? null,
    });

    if (!row.jobProfileId && projectSubmission) {
      await this.projectInterview.saveCandidateResult(candidateToken, {
        scorePct: roundScoreForResult,
        outcome: 'completed',
      });
    }

    await this.stopRecordings(candidateToken, row.livekitEgressId);

    return this.getSession(candidateToken);
  }

  private async stopRecordings(candidateToken: string, legacyEgressId?: string | null) {
    try {
      await this.recordings.stopActive(candidateToken, legacyEgressId);
    } catch (err) {
      this.logger.warn(
        `Recording stop failed token=${candidateToken}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Track egresses finish uploading after the voice engine stops them.
    for (const delayMs of [0, 30_000, 120_000]) {
      setTimeout(() => {
        this.recordings.syncTrackEgresses(candidateToken, { force: true }).catch((err) => {
          this.logger.warn(
            `Track recording sync failed token=${candidateToken}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, delayMs).unref();
    }
  }

  /**
   * AI Screening session end: persist PENDING audit, advance pipeline (soft flags),
   * then run analyzer asynchronously without blocking the candidate.
   */
  async completeAiScreening(
    candidateToken: string,
    body: {
      transcript?: Array<Record<string, unknown>>;
      conversation_state?: Record<string, unknown>;
      round_config?: Record<string, unknown>;
      job_profile_context?: Record<string, unknown>;
      ended_by?: 'candidate';
      merge_to_verbal?: boolean;
    },
  ) {
    const row = await this.repo.requireByToken(candidateToken);
    if (body.ended_by === 'candidate') {
      await this.markCandidateVoluntaryExit(candidateToken);
    }
    const pending = this.screeningAnalyzer.buildPendingAudit({
      transcript: body.transcript ?? [],
      conversationState: body.conversation_state ?? {},
      roundConfig: body.round_config,
      jobProfileContext: body.job_profile_context,
    });

    const transcriptPatch =
      Array.isArray(body.transcript) && body.transcript.length
        ? { stage1ChatHistory: body.transcript }
        : {};

    // Merged screening→verbal: soft-flag analysis still runs, but do not complete
    // the interview or advance the job pipeline — verbal continues in the same room.
    if (body.merge_to_verbal === true && body.ended_by !== 'candidate') {
      await this.repo.patch(candidateToken, {
        screeningVoiceAudit: pending,
        currentPhase: AutonomousInterviewPhase.INTRO_VERBAL,
        ...transcriptPatch,
      });
      this.viewport.emitViewportShift(candidateToken, AutonomousInterviewPhase.INTRO_VERBAL, {
        screeningComplete: true,
        mergeToVerbal: true,
        subPhase: 'transition',
        analyzerStatus: 'PENDING',
      });
      {
        const portalToken = (row.proctorSummary as any)?.portalToken as string | undefined;
        void this.roundSnapshots.upsertFromInterviewToken(candidateToken, portalToken);
      }
      void this.runScreeningAnalyzer(candidateToken);
      return this.getSession(candidateToken);
    }

    // Stage-scoped only: do NOT write finalDecision — AI Screening is not a hiring decision.
    // Shared interview row is reused by later HR/tech rounds; leave finalDecision untouched.
    // Mark this LiveKit interview session complete so the candidate UI can leave the room.
    await this.repo.patch(candidateToken, {
      screeningVoiceAudit: pending,
      currentPhase: AutonomousInterviewPhase.COMPLETED,
      ...transcriptPatch,
    });

    this.viewport.emitViewportShift(candidateToken, AutonomousInterviewPhase.COMPLETED, {
      screeningComplete: true,
      analyzerStatus: 'PENDING',
    });

    // Soft flags only — always advance when linked to a portal application.
    // Do not gate on isPreview: demo_testing sessions must unlock the next round.
    // Analyzer completion is async and must not block progression.
    if (row.jobProfileId) {
      try {
        const portalToken =
          (typeof (row.proctorSummary as Record<string, unknown> | null)?.portalToken === 'string'
            ? String((row.proctorSummary as Record<string, unknown>).portalToken)
            : null) ||
          (candidateToken.startsWith('demo_') ? candidateToken : null);
        if (portalToken) {
          await this.jobPipeline.advanceApplicationStage(portalToken);
        } else {
          // Fallback: application may use the LiveKit token as candidate_token
          await this.jobPipeline.advanceApplicationStage(candidateToken);
        }
      } catch (err) {
        this.logger.warn(
          `AI Screening advance failed token=${candidateToken}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Persist attempt snapshot immediately so Assessment Reports show the
    // transcript / evaluating status before the analyzer finishes.
    {
      const portalToken = (row.proctorSummary as any)?.portalToken as string | undefined;
      void this.roundSnapshots.upsertFromInterviewToken(candidateToken, portalToken);
    }

    await this.stopRecordings(candidateToken, row.livekitEgressId);

    void this.runScreeningAnalyzer(candidateToken);

    return this.getSession(candidateToken);
  }

  async retryScreeningAnalyzer(candidateToken: string) {
    const row = await this.repo.requireByToken(candidateToken);
    const audit = (row.screeningVoiceAudit ?? null) as ScreeningVoiceAudit | null;
    if (!audit?.transcript?.length) {
      throw new BadRequestException('No AI Screening transcript available to analyze');
    }
    const pending: ScreeningVoiceAudit = {
      ...audit,
      analyzerStatus: 'PENDING',
      error: null,
      screeningResult: null,
      analyzedAt: null,
    };
    await this.repo.patch(candidateToken, { screeningVoiceAudit: pending });
    await this.runScreeningAnalyzer(candidateToken);
    return this.getSession(candidateToken);
  }

  private async runScreeningAnalyzer(candidateToken: string) {
    try {
      const row = await this.repo.requireByToken(candidateToken);
      const audit = (row.screeningVoiceAudit ?? null) as ScreeningVoiceAudit | null;
      if (!audit) return;
      const completed = await this.screeningAnalyzer.analyze(audit);
      await this.repo.patch(candidateToken, { screeningVoiceAudit: completed });
      
      const portalToken = (row.proctorSummary as any)?.portalToken;
      await this.roundSnapshots.upsertFromInterviewToken(candidateToken, portalToken);
    } catch (err) {
      this.logger.warn(
        `runScreeningAnalyzer failed token=${candidateToken}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      try {
        const row = await this.repo.requireByToken(candidateToken);
        const audit = (row.screeningVoiceAudit ?? {}) as ScreeningVoiceAudit;
        await this.repo.patch(candidateToken, {
          screeningVoiceAudit: {
            ...audit,
            analyzerStatus: 'FAILED',
            screeningResult: null,
            error: err instanceof Error ? err.message : String(err),
            analyzedAt: new Date().toISOString(),
          },
        });
      } catch {
        /* ignore */
      }
    }
  }

  assertServiceKey(header?: string) {
    const expected = process.env.AUTONOMOUS_INTERVIEW_SERVICE_KEY?.trim();
    if (!expected) return;
    if (header !== expected) {
      throw new ForbiddenException('Invalid service key');
    }
  }

  /** Normalize recording URLs to local-recordings paths (no S3). */
  private formatRecordingUrl(url: string): string {
    if (!url) return url;
    let key = url;

    if (url.startsWith('s3://')) {
      const parts = url.replace('s3://', '').split('/');
      parts.shift(); // drop bucket
      key = parts.join('/');
    } else if (url.startsWith('http')) {
      try {
        const u = new URL(url);
        key = decodeURIComponent(u.pathname || '').replace(/^\/+/, '');
      } catch {
        /* keep key */
      }
    }

    key = key.replace(/^\/+/, '');
    if (key.startsWith('local-recordings/')) return key;
    if (key.startsWith('out/')) key = key.slice('out/'.length);
    return `local-recordings/${key}`;
  }

  async saveMergedRecordingUrl(
    candidateToken: string,
    recordingUrl: string,
    stageId?: string | null,
  ) {
    const formattedUrl = this.formatRecordingUrl(recordingUrl);
    const row = await this.repo.findByTokenForAdmin(candidateToken);
    const meta = (row?.proctorSummary as Record<string, unknown> | null) ?? {};
    const roundType = resolveRoundType({
      voicePhase: stageId,
      stageType: stageId || (typeof meta.stageType === 'string' ? meta.stageType : null),
      currentPhase: row?.currentPhase ?? stageId,
    });
    // Prefer explicit stage_id when it is already a known round_type.
    const explicit = Object.values(AutonomousInterviewRoundType).find((v) => v === stageId);
    await this.rounds.setMergedRecordingUrl(
      candidateToken,
      explicit ?? roundType,
      formattedUrl,
    );
  }

  async createAdminMonitorJoin(
    token: string,
    adminId: string,
    opts?: { round_type?: string },
  ) {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) throw new BadRequestException('Interview token is required');

    let sessions = await this.repo.findAllForPortalToken(trimmed);
    if (!sessions.length) {
      const one = await this.repo.findByToken(trimmed);
      if (one) sessions = [one];
    }
    // Prefer real LiveKit sessions (ses_*) over portal/demo shell rows.
    sessions = [...sessions].sort((a, b) => {
      const score = (s: typeof a) => {
        let n = 0;
        if (s.candidateToken.startsWith('ses_')) n += 8;
        if (s.livekitRoomName) n += 4;
        if (s.currentPhase !== AutonomousInterviewPhase.COMPLETED) n += 2;
        if (s.candidateToken !== trimmed) n += 1; // prefer linked session over portal-token shell
        return n;
      };
      return score(b) - score(a);
    });
    if (!sessions.length) {
      throw new NotFoundException(
        'No interview session found for this candidate. They may not have started a round yet.',
      );
    }

    type RoomCandidate = {
      session: (typeof sessions)[number];
      roundType: AutonomousInterviewRoundType;
      roomName: string;
      roundStatus: string | null;
      /** When the candidate entered this round (round row created_at). */
      roundStartedAt: Date | null;
      rounds: Array<{
        round_type: string;
        status: string;
        livekit_room_name: string | null;
      }>;
    };

    const roomCandidates: RoomCandidate[] = [];
    for (const session of sessions) {
      if (session.currentPhase === AutonomousInterviewPhase.COMPLETED) continue;
      const rounds = await this.rounds.findByToken(session.candidateToken);
      const requestedRound = opts?.round_type?.trim();
      const selectedRound =
        (requestedRound
          ? rounds.find((r) => r.roundType === requestedRound)
          : undefined) ??
        rounds.find((r) => r.status === AutonomousInterviewRoundStatus.IN_PROGRESS) ??
        rounds[rounds.length - 1] ??
        null;
      const roundType =
        selectedRound?.roundType ??
        resolveRoundType({
          currentPhase: session.currentPhase,
          stageType:
            typeof (session.proctorSummary as Record<string, unknown> | null)?.stageType ===
            'string'
              ? String((session.proctorSummary as Record<string, unknown>).stageType)
              : null,
        });
      const roomName =
        selectedRound?.livekitRoomName?.trim() ||
        session.livekitRoomName?.trim() ||
        roomNameForRound(session.candidateToken, roundType);
      roomCandidates.push({
        session,
        roundType,
        roomName,
        roundStatus: selectedRound?.status ?? null,
        roundStartedAt: selectedRound?.createdAt ?? null,
        rounds: rounds.map((r) => ({
          round_type: r.roundType,
          status: r.status,
          livekit_room_name: r.livekitRoomName,
        })),
      });
    }

    if (!roomCandidates.length) {
      // Fall back to newest session even if completed, so admin can still inspect.
      const session = sessions[0];
      const rounds = await this.rounds.findByToken(session.candidateToken);
      const requestedRound = opts?.round_type?.trim();
      const selectedRound =
        (requestedRound
          ? rounds.find((r) => r.roundType === requestedRound)
          : undefined) ??
        rounds.find((r) => r.status === AutonomousInterviewRoundStatus.IN_PROGRESS) ??
        rounds[rounds.length - 1] ??
        null;
      const roundType =
        selectedRound?.roundType ??
        resolveRoundType({ currentPhase: session.currentPhase });
      const roomName =
        selectedRound?.livekitRoomName?.trim() ||
        session.livekitRoomName?.trim() ||
        roomNameForRound(session.candidateToken, roundType);
      roomCandidates.push({
        session,
        roundType,
        roomName,
        roundStatus: selectedRound?.status ?? null,
        roundStartedAt: selectedRound?.createdAt ?? null,
        rounds: rounds.map((r) => ({
          round_type: r.roundType,
          status: r.status,
          livekit_room_name: r.livekitRoomName,
        })),
      });
    }

    // Prefer a room that already has a candidate (or any) participant online.
    let chosen = roomCandidates[0];
    let liveIdentities: string[] = [];
    for (const candidate of roomCandidates) {
      const identities = await this.livekit.listRoomParticipantIdentities(candidate.roomName);
      if (identities.some((id) => id.startsWith('candidate-') || id.startsWith('agent-'))) {
        chosen = candidate;
        liveIdentities = identities;
        break;
      }
      if (!liveIdentities.length && identities.length) {
        chosen = candidate;
        liveIdentities = identities;
      }
    }
    if (!liveIdentities.length) {
      liveIdentities = await this.livekit.listRoomParticipantIdentities(chosen.roomName);
    }

    const active = chosen.session;
    const portalToken =
      typeof (active.proctorSummary as Record<string, unknown> | null)?.portalToken === 'string'
        ? String((active.proctorSummary as Record<string, unknown>).portalToken).trim()
        : active.candidateToken;

    const safeAdmin = String(adminId || 'admin')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 24);
    const identity = `admin-monitor-${safeAdmin}-${Date.now()}`.slice(0, 64);

    const { token: livekitToken, url: livekitUrl } = await this.livekit.createMonitorToken({
      roomName: chosen.roomName,
      identity,
      name: 'Admin Monitor',
    });

    let candidateName: string | null = null;
    let resumeUrl: string | null = null;
    try {
      const resolved = await this.resumeSkills.resolveForInterview(active);
      candidateName = resolved.candidateName?.trim() || null;
      resumeUrl = resolved.resumeUrl?.trim() || null;
    } catch (err) {
      this.logger.warn(
        `Admin monitor resume lookup failed token=${active.candidateToken}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const maxStrikes = Number(process.env.PROCTOR_MAX_STRIKES ?? 5);
    const strikeCount = Number(
      (active.proctorSummary as Record<string, unknown> | null)?.media_strike_count ?? 0,
    );

    return {
      livekitToken,
      livekitUrl,
      roomName: chosen.roomName,
      identity,
      candidateToken: active.candidateToken,
      portalToken,
      currentPhase: active.currentPhase,
      roundType: chosen.roundType,
      roundStatus: chosen.roundStatus,
      rounds: chosen.rounds,
      participantsOnline: liveIdentities,
      monitorMode: true,
      canPublish: true,
      candidateName,
      resumeUrl,
      strikeCount: Number.isFinite(strikeCount) ? strikeCount : 0,
      maxStrikes: Number.isFinite(maxStrikes) && maxStrikes > 0 ? Math.floor(maxStrikes) : 5,
      // Elapsed / Flag Moment clock: when candidate entered this round (not session create / admin join).
      sessionStartedAt:
        chosen.roundStartedAt?.toISOString?.() ??
        active.createdAt?.toISOString?.() ??
        null,
    };
  }

  async saveRawTracks(
    candidateToken: string,
    tracks: { kind: string; url: string }[],
    stageId?: string | null,
  ) {
    const explicit = Object.values(AutonomousInterviewRoundType).find((v) => v === stageId);
    const row = await this.repo.findByTokenForAdmin(candidateToken);
    const meta = (row?.proctorSummary as Record<string, unknown> | null) ?? {};
    const roundType =
      explicit ??
      resolveRoundType({
        stageType: typeof meta.stageType === 'string' ? meta.stageType : null,
        currentPhase: row?.currentPhase,
      });
    for (const track of tracks) {
      const formattedUrl = this.formatRecordingUrl(track.url);
      await this.recordings.saveRawTrack(candidateToken, track.kind, formattedUrl, roundType);
    }
  }
}

