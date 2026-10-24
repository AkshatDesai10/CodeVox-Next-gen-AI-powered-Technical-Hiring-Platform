import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { AssessmentExecutionRepository } from '../assessment-execution/assessment-execution.repository';
import { AssessmentExecutionService } from '../assessment-execution/assessment-execution.service';
import { AutonomousInterviewRepository } from './autonomous-interview.repository';
import { CandidateAutonomousInterviewMysql } from './entities/candidate-autonomous-interview.mysql.entity';
import { InterviewProctorService } from '../proctor/interview-proctor.service';
import { ResumeSkillsResolver } from './resume-skills.resolver';
import {
  InterviewRecordingService,
  type InterviewRecordingView,
} from './interview-recording.service';
import { toRecordingPlaybackUrl } from './recording-playback';

export type InterviewAuditSummary = {
  token: string;
  filename: string;
  finalizedAt: string | null;
  depthScore: number | null;
  turnCount: number;
  techStack: string | null;
  candidateName?: string | null;
  endedByCandidate?: boolean;
};

export type SandboxSubmissionSummary = {
  questionId: string;
  language: string;
  sourceCode: string;
  score: number | null;
  executionTimeMs: number | null;
  status: string | null;
  passedTestCases: number;
  totalTestCases: number;
};

export type SandboxReport = {
  assessmentTitle: string | null;
  attemptScore: number | null;
  submittedAt: string | null;
  language: string | null;
  sourceCode: string | null;
  codeQualityScore: number | null;
  architecturalFlaws: string[];
  passedTestCases: number;
  totalTestCases: number;
  submissions: SandboxSubmissionSummary[];
  hasSubmission: boolean;
};

export type InterviewReportEnrichment = {
  stage1VoiceScore: number | null;
  submittedCode: string | null;
  codeQualityScore: number | null;
  architecturalFlaws: string[] | null;
  currentPhase: string | null;
  candidateAssessmentId: string | null;
  finalDecision: string | null;
  /** Signed playback URL of the newest recording. */
  recordingUrl: string | null;
  recordings: InterviewRecordingView[];
  sandbox: SandboxReport | null;
  hrVoiceAudit?: Record<string, unknown> | null;
  screeningVoiceAudit?: Record<string, unknown> | null;
  integrity?: {
    identity_verified_at: string | null;
    liveness_verified_at: string | null;
    proctor_summary: Record<string, unknown> | null;
    proctor_events: Array<{
      event_type: string;
      severity: string;
      payload?: Record<string, unknown>;
      created_at?: string;
    }>;
  } | null;
};

export type InterviewReportResponse = {
  report: Record<string, unknown>;
  filename: string;
  enrichment: InterviewReportEnrichment | null;
  versions: InterviewAuditSummary[];
};

@Injectable()
export class InterviewAuditService {
  private readonly logger = new Logger(InterviewAuditService.name);

  constructor(
    private readonly repo: AutonomousInterviewRepository,
    private readonly assessmentExecution: AssessmentExecutionService,
    private readonly executionRepo: AssessmentExecutionRepository,
    private readonly interviewProctor: InterviewProctorService,
    private readonly resumeSkills: ResumeSkillsResolver,
    private readonly recordings: InterviewRecordingService,
  ) { }

  private auditDir(): string {
    const configured = process.env.INTERVIEW_AUDIT_LOG_DIR?.trim();
    if (configured) return path.resolve(configured);
    return path.resolve(process.cwd(), 'services', 'voice-engine', 'audit_logs');
  }

  private parseFilename(name: string): { token: string; stamp: string } | null {
    const match = /^(.+)_(\d{8}T\d{6}Z)\.json$/i.exec(name);
    if (!match) return null;
    return { token: match[1], stamp: match[2] };
  }

  private async readAuditFile(filePath: string): Promise<Record<string, unknown>> {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  private applyDbVoiceAudit(
    report: Record<string, unknown>,
    dbAudit: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!dbAudit || typeof dbAudit !== 'object') return report;
    const out: Record<string, unknown> = { ...report };
    // DB is source of truth for Final Evaluation fields once Nest persists them.
    if (Array.isArray(dbAudit.rubric_scorecard)) {
      out.rubric_scorecard = dbAudit.rubric_scorecard;
    }
    if ('weighted_overall_10' in dbAudit) {
      out.weighted_overall_10 = dbAudit.weighted_overall_10;
    }
    if ('weighted_overall_rounded' in dbAudit) {
      out.weighted_overall_rounded = dbAudit.weighted_overall_rounded;
    }
    return out;
  }

  private dbAuditAsSummary(
    row: CandidateAutonomousInterviewMysql,
  ): InterviewAuditSummary | null {
    let raw = row.stage1VoiceAudit;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (err) { }
    }
    if (!raw || typeof raw !== 'object') return null;
    const audit = raw as Record<string, unknown>;
    const turns = Array.isArray(audit.turns) ? audit.turns : [];
    const depth =
      typeof audit.weighted_overall_rounded === 'number'
        ? audit.weighted_overall_rounded
        : typeof audit.depth_score === 'number'
          ? audit.depth_score
          : row.stage1VoiceScore ?? null;
    return {
      token: row.candidateToken,
      filename: 'db:stage1_voice_audit',
      finalizedAt:
        typeof audit.finalized_at === 'string'
          ? audit.finalized_at
          : row.updatedAt?.toISOString?.() ?? null,
      depthScore: depth,
      turnCount: turns.length,
      techStack: typeof audit.tech_stack === 'string' ? audit.tech_stack : row.techStack,
    };
  }

  private dbHrAuditAsSummary(
    row: CandidateAutonomousInterviewMysql,
  ): InterviewAuditSummary | null {
    let raw = row.hrVoiceAudit;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    if (!raw || typeof raw !== 'object') return null;
    const audit = raw as Record<string, unknown>;
    const turns = Array.isArray(audit.turns) ? audit.turns : [];
    const score =
      typeof audit.weighted_competency_score === 'number'
        ? Number(audit.weighted_competency_score)
        : null;
    return {
      token: row.candidateToken,
      filename: 'db:hr_voice_audit',
      finalizedAt: row.updatedAt?.toISOString?.() ?? null,
      depthScore: score,
      turnCount: turns.length,
      techStack: 'AI Behavioural',
    };
  }

  private dbScreeningAuditAsSummary(
    row: CandidateAutonomousInterviewMysql,
  ): InterviewAuditSummary | null {
    let raw = row.screeningVoiceAudit;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    if (!raw || typeof raw !== 'object') return null;
    const audit = raw as Record<string, unknown>;
    const transcript = Array.isArray(audit.transcript) ? audit.transcript : [];
    return {
      token: row.candidateToken,
      filename: 'db:screening_voice_audit',
      finalizedAt: row.updatedAt?.toISOString?.() ?? null,
      depthScore: null,
      turnCount: transcript.length,
      techStack: 'AI Screening',
    };
  }

  /** When a session has recording/chat but no formal audit payload yet. */
  private dbSessionFallbackSummary(
    row: CandidateAutonomousInterviewMysql,
  ): InterviewAuditSummary | null {
    const turns = this.chatHistoryToInterviewTurns(
      row.stage3ChatHistory ?? row.stage1ChatHistory,
    );
    const hasContent =
      turns.length > 0 ||
      !!row.recordingUrl ||
      !!row.hrVoiceAudit ||
      !!row.stage1VoiceAudit ||
      !!row.screeningVoiceAudit;
    if (!hasContent) return null;
    const proctor = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const isBehavioral =
      !!proctor.isBehavioral || String(proctor.stageType ?? '') === 'hr_verbal';
    const isAiVerbal = String(proctor.stageType ?? '') === 'ai_verbal';
    return {
      token: row.candidateToken,
      filename: 'db:session_fallback',
      finalizedAt: row.updatedAt?.toISOString?.() ?? null,
      depthScore: null,
      turnCount: turns.length,
      techStack: isBehavioral ? 'AI Behavioural' : isAiVerbal ? 'AI Verbal' : row.techStack ?? 'Interview',
    };
  }

  private buildSessionFallbackReport(
    token: string,
    row: CandidateAutonomousInterviewMysql,
  ): Record<string, unknown> {
    const proctor = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const isBehavioral =
      !!proctor.isBehavioral || String(proctor.stageType ?? '') === 'hr_verbal';
    const isAiVerbal = String(proctor.stageType ?? '') === 'ai_verbal';
    let turns = this.chatHistoryToInterviewTurns(row.stage3ChatHistory);
    if (!turns.length) {
      turns = this.chatHistoryToInterviewTurns(row.stage1ChatHistory);
    }
    return {
      session_id: token,
      tech_stack: isBehavioral ? 'AI Behavioural' : isAiVerbal ? 'AI Verbal' : row.techStack ?? 'Interview',
      resume_skills: [],
      covered_topics: [],
      skipped_topics: [],
      turns,
      depth_score: row.stage1VoiceScore ?? 0,
      provider_summary: {},
      finalized_at: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      resume_alignment: {
        resume_skills: [],
        verified: [],
        skipped_due_to_struggles: [],
        un_assessed_due_to_time: [],
        per_skill: {},
      },
      rubric_scorecard: [],
      weighted_overall_10: null,
      hr_voice_audit:
        row.hrVoiceAudit && typeof row.hrVoiceAudit === 'object'
          ? row.hrVoiceAudit
          : null,
    };
  }

  /** Map raw AI Screening transcript → technical InterviewTurn shape for the report UI. */
  private normalizeScreeningTranscriptToInterviewTurns(
    transcript: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const turns: Array<Record<string, unknown>> = [];
    let currentQuestion = '';

    for (const msg of transcript) {
      if (msg.role === 'assistant') {
        if (currentQuestion) {
          turns.push({
            turn_index: turns.length + 1,
            topic_domain: 'screening',
            level: 'SCREENING',
            question_asked: currentQuestion,
            candidate_reply: '',
            intent_label: 'ANSWER',
            confidence_delta: 0,
            active_provider: 'screening',
            model: 'screening_verbal',
            action_mode: 'ask',
          });
        }
        currentQuestion = String(msg.content ?? '');
      } else if (msg.role === 'user') {
        if (currentQuestion) {
          turns.push({
            turn_index: turns.length + 1,
            topic_domain: 'screening',
            level: 'SCREENING',
            question_asked: currentQuestion,
            candidate_reply: String(msg.content ?? ''),
            intent_label: 'ANSWER',
            confidence_delta: 0,
            active_provider: 'screening',
            model: 'screening_verbal',
            action_mode: 'ask',
          });
          currentQuestion = '';
        } else {
          turns.push({
            turn_index: turns.length + 1,
            topic_domain: 'screening',
            level: 'SCREENING',
            question_asked: '',
            candidate_reply: String(msg.content ?? ''),
            intent_label: 'ANSWER',
            confidence_delta: 0,
            active_provider: 'screening',
            model: 'screening_verbal',
            action_mode: 'ask',
          });
        }
      }
    }
    if (currentQuestion) {
      turns.push({
        turn_index: turns.length + 1,
        topic_domain: 'screening',
        level: 'SCREENING',
        question_asked: currentQuestion,
        candidate_reply: '',
        intent_label: 'ANSWER',
        confidence_delta: 0,
        active_provider: 'screening',
        model: 'screening_verbal',
        action_mode: 'ask',
      });
    }
    return turns;
  }

  /** Map nested behavioural turn events → technical InterviewTurn shape for the report UI. */
  private normalizeHrTurnsToInterviewTurns(
    hr: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    const raw = Array.isArray(hr.turns) ? hr.turns : [];
    return raw.map((entry, idx) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const nested =
        item.turn && typeof item.turn === 'object'
          ? (item.turn as Record<string, unknown>)
          : item;
      const question = String(
        nested.question_text ?? nested.question_asked ?? item.question_text ?? '',
      );
      const reply = String(
        nested.candidate_answer_raw ??
        nested.candidate_reply ??
        item.candidate_answer_raw ??
        '',
      );
      const competencyId = String(
        nested.competency_id ?? item.competency_id ?? 'behavioural',
      );
      return {
        turn_index: idx + 1,
        topic_domain: competencyId,
        level: 'BEHAVIOURAL',
        question_asked: question,
        candidate_reply: reply,
        intent_label: String(
          (item.decision as { action?: string } | undefined)?.action ??
          nested.intent_label ??
          'ANSWER',
        ),
        confidence_delta: 0,
        active_provider: 'behavioural',
        model: 'hr_verbal',
        action_mode: String(
          (item.decision as { action?: string } | undefined)?.action ?? 'CONTINUE',
        ),
        resume_tech: '',
        strike_count: 0,
        tech_index: 0,
      };
    });
  }

  private hrCompetenciesToRubric(
    hr: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    const comps = Array.isArray(hr.competencies)
      ? hr.competencies
      : Array.isArray(hr.competency_evaluations)
        ? hr.competency_evaluations
        : [];
    return comps.map((c, idx) => {
      const row = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const score5 = typeof row.score === 'number' ? Number(row.score) : null;
      return {
        id: String(row.competency_id ?? `hr_${idx}`),
        competency: String(row.name ?? row.competency_id ?? `Competency ${idx + 1}`),
        score_10: score5 != null ? score5 * 2 : null,
        weight_pct: typeof row.weight === 'number' ? Number(row.weight) : undefined,
        justification: String(
          row.reasoning ?? row.level ?? `Behavioural score ${score5 ?? '—'}/5`,
        ),
      };
    });
  }

  private hasReportableAudit(row: CandidateAutonomousInterviewMysql | null): boolean {
    if (!row) return false;
    return !!(
      row.hrVoiceAudit ||
      row.stage1VoiceAudit ||
      row.screeningVoiceAudit ||
      row.recordingUrl ||
      (Array.isArray(row.stage3ChatHistory) && row.stage3ChatHistory.length > 0) ||
      (Array.isArray(row.stage1ChatHistory) && row.stage1ChatHistory.length > 0)
    );
  }

  /**
   * demo_/portal tokens are application shells. Prefer the behavioural ses_ round
   * with the richest audit/chat/recording — not an empty newer restart.
   */
  private async resolveSessionForPortalToken(
    portalToken: string,
  ): Promise<CandidateAutonomousInterviewMysql | null> {
    const rows = await this.repo.findAllForPortalToken(portalToken);

    if (!rows.length) return null;

    const score = (r: CandidateAutonomousInterviewMysql) => {
      let s = 0;
      if (r.hrVoiceAudit) s += 100;
      if (r.stage1VoiceAudit) s += 100;
      if (r.screeningVoiceAudit) s += 80;
      if (Array.isArray(r.stage3ChatHistory) && r.stage3ChatHistory.length) s += 40;
      if (Array.isArray(r.stage1ChatHistory) && r.stage1ChatHistory.length) s += 40;
      if (r.recordingUrl) s += 20;
      return s;
    };

    const withContent = rows.filter((r) => this.hasReportableAudit(r));
    const pool = withContent.length ? withContent : rows;

    const behavioral = pool
      .filter((r) => {
        const ps = (r.proctorSummary as Record<string, unknown> | null) ?? {};
        return (
          !!ps.isBehavioral ||
          String(ps.stageType ?? '') === 'hr_verbal' ||
          !!r.hrVoiceAudit
        );
      })
      .sort((a, b) => {
        const d = score(b) - score(a);
        if (d !== 0) return d;
        return +new Date(b.createdAt).valueOf() - +new Date(a.createdAt).valueOf();
      });
    if (behavioral[0] && score(behavioral[0]) > 0) return behavioral[0];
    if (behavioral[0]) return behavioral[0];

    const ranked = [...pool].sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return +new Date(b.createdAt).valueOf() - +new Date(a.createdAt).valueOf();
    });
    const ses = ranked.find((r) => String(r.candidateToken ?? '').startsWith('ses_'));
    return ses ?? ranked[0] ?? null;
  }

  /** Prefer HR/screening DB audits for sessions that are not technical stage1. */
  private preferAuditVersion(
    versions: InterviewAuditSummary[],
    row: CandidateAutonomousInterviewMysql | null | undefined,
  ): InterviewAuditSummary | undefined {
    if (!versions.length) return undefined;
    const proctor = (row?.proctorSummary as Record<string, unknown> | null) ?? {};
    const isBehavioral =
      !!proctor.isBehavioral ||
      String(proctor.stageType ?? '') === 'hr_verbal' ||
      (!!row?.hrVoiceAudit && !row?.stage1VoiceAudit);
    if (isBehavioral) {
      return (
        versions.find((v) => v.filename === 'db:hr_voice_audit') ??
        versions.find((v) => v.filename === 'db:session_fallback') ??
        versions.find((v) => v.filename.startsWith('db:hr')) ??
        versions[0]
      );
    }
    if (row?.screeningVoiceAudit && !row?.stage1VoiceAudit) {
      return (
        versions.find((v) => v.filename === 'db:screening_voice_audit') ?? versions[0]
      );
    }
    return (
      versions.find((v) => v.filename === 'db:stage1_voice_audit') ?? versions[0]
    );
  }

  /** Map chat history → InterviewTurn shape when hr.turns is empty. */
  private chatHistoryToInterviewTurns(
    raw: unknown,
  ): Array<Record<string, unknown>> {
    let rows: unknown = raw;
    if (typeof rows === 'string') {
      try {
        rows = JSON.parse(rows);
      } catch {
        return [];
      }
    }
    if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
      const obj = rows as Record<string, unknown>;
      rows = obj.messages ?? obj.history ?? obj.chat_history ?? obj.transcript ?? [];
    }
    if (!Array.isArray(rows)) return [];

    const turns: Array<Record<string, unknown>> = [];
    let currentQuestion = '';
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const roleRaw = String(r.role ?? r.speaker ?? '').toLowerCase();
      const text = String(r.content ?? r.text ?? r.message ?? '').trim();
      if (!text) continue;
      const isCandidate =
        roleRaw === 'user' || roleRaw === 'candidate' || roleRaw === 'human';
      if (!isCandidate) {
        if (currentQuestion) {
          turns.push({
            turn_index: turns.length + 1,
            topic_domain: 'behavioural',
            level: 'BEHAVIOURAL',
            question_asked: currentQuestion,
            candidate_reply: '',
            intent_label: 'ANSWER',
            confidence_delta: 0,
            active_provider: 'behavioural',
            model: 'hr_verbal',
            action_mode: 'CONTINUE',
          });
        }
        currentQuestion = text;
      } else if (currentQuestion) {
        turns.push({
          turn_index: turns.length + 1,
          topic_domain: 'behavioural',
          level: 'BEHAVIOURAL',
          question_asked: currentQuestion,
          candidate_reply: text,
          intent_label: 'ANSWER',
          confidence_delta: 0,
          active_provider: 'behavioural',
          model: 'hr_verbal',
          action_mode: 'CONTINUE',
        });
        currentQuestion = '';
      } else {
        turns.push({
          turn_index: turns.length + 1,
          topic_domain: 'behavioural',
          level: 'BEHAVIOURAL',
          question_asked: '',
          candidate_reply: text,
          intent_label: 'ANSWER',
          confidence_delta: 0,
          active_provider: 'behavioural',
          model: 'hr_verbal',
          action_mode: 'CONTINUE',
        });
      }
    }
    if (currentQuestion) {
      turns.push({
        turn_index: turns.length + 1,
        topic_domain: 'behavioural',
        level: 'BEHAVIOURAL',
        question_asked: currentQuestion,
        candidate_reply: '',
        intent_label: 'ANSWER',
        confidence_delta: 0,
        active_provider: 'behavioural',
        model: 'hr_verbal',
        action_mode: 'CONTINUE',
      });
    }
    return turns;
  }

  private async listAllSummaries(): Promise<InterviewAuditSummary[]> {
    const dir = this.auditDir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      this.logger.warn(
        `Audit directory not readable (${dir}): ${err instanceof Error ? err.message : err}`,
      );
      names = [];
    }

    const summaries: InterviewAuditSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const parsed = this.parseFilename(name);
      if (!parsed) continue;
      try {
        const payload = await this.readAuditFile(path.join(dir, name));
        const turns = Array.isArray(payload.turns) ? payload.turns : [];
        summaries.push({
          token: String(payload.session_id ?? parsed.token),
          filename: name,
          finalizedAt:
            typeof payload.finalized_at === 'string' ? payload.finalized_at : null,
          depthScore:
            typeof payload.depth_score === 'number' ? payload.depth_score : null,
          turnCount: turns.length,
          techStack:
            typeof payload.tech_stack === 'string' ? payload.tech_stack : null,
        });
      } catch (err) {
        this.logger.debug(`Skipping corrupt audit file ${name}: ${err}`);
      }
    }

    // Include DB-persisted audits so reports work without shared disk.
    try {
      const dbRows = await this.repo.findWithStage1VoiceAudit();
      const diskTokens = new Set(summaries.map((s) => s.token));
      for (const row of dbRows) {
        if (diskTokens.has(row.candidateToken)) continue;
        const summary = this.dbAuditAsSummary(row);
        if (summary) summaries.push(summary);
      }
    } catch (err) {
      this.logger.warn(
        `Could not list DB voice audits: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      const hrRows = await this.repo.findWithHrVoiceAudit();
      const existingTokens = new Set(summaries.map((s) => s.token));
      for (const row of hrRows) {
        if (existingTokens.has(row.candidateToken)) continue;
        const summary = this.dbHrAuditAsSummary(row);
        if (summary) {
          summaries.push(summary);
          existingTokens.add(row.candidateToken);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not list DB HR voice audits: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      const screeningRows = await this.repo.findWithScreeningVoiceAudit();
      const existingTokens = new Set(summaries.map((s) => s.token));
      for (const row of screeningRows) {
        if (existingTokens.has(row.candidateToken)) continue;
        const summary = this.dbScreeningAuditAsSummary(row);
        if (summary) {
          summaries.push(summary);
          existingTokens.add(row.candidateToken);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not list DB Screening voice audits: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      const chatRows = await this.repo.findWithChatHistory();
      const existingTokens = new Set(summaries.map((s) => s.token));
      for (const row of chatRows) {
        if (existingTokens.has(row.candidateToken)) continue;
        const summary = this.dbSessionFallbackSummary(row);
        if (!summary) continue;
        summaries.push(summary);
        existingTokens.add(row.candidateToken);
      }
    } catch (err) {
      this.logger.warn(
        `Could not list chat-only interview sessions: ${err instanceof Error ? err.message : err}`,
      );
    }

    summaries.sort((a, b) => {
      const aKey = a.finalizedAt ?? a.filename;
      const bKey = b.finalizedAt ?? b.filename;
      return bKey.localeCompare(aKey);
    });
    return summaries;
  }

  async listReports(): Promise<InterviewAuditSummary[]> {
    const all = await this.listAllSummaries();
    const seen = new Set<string>();
    const latestPerToken: InterviewAuditSummary[] = [];
    for (const row of all) {
      if (seen.has(row.token)) continue;
      seen.add(row.token);
      latestPerToken.push(row);
    }

    await Promise.all(
      latestPerToken.map(async (summary) => {
        try {
          const row = await this.repo.findByToken(summary.token);
          if (row) {
            const resolved = await this.resumeSkills.resolveForInterview(row);
            summary.candidateName = resolved.candidateName || null;
            const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
            const byType = (meta.by_type ?? {}) as Record<string, number>;
            summary.endedByCandidate =
              meta.bndPhase !== 'build' &&
              (meta.terminated_by === 'candidate' ||
                (byType.candidate_ended_interview ?? 0) > 0);
          }
        } catch (err) {
          this.logger.debug(`Could not resolve candidate name for ${summary.token}: ${err}`);
        }
      })
    );

    return latestPerToken;
  }

  private parseTestCounts(executionOutput?: string | null): {
    passed: number;
    total: number;
  } {
    if (!executionOutput?.trim()) {
      return { passed: 0, total: 0 };
    }
    try {
      const parsed = JSON.parse(executionOutput) as {
        cases?: { passed?: boolean }[];
      };
      const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
      return {
        passed: cases.filter((entry) => entry.passed).length,
        total: cases.length,
      };
    } catch {
      return { passed: 0, total: 0 };
    }
  }

  private async buildSandboxReport(
    row: CandidateAutonomousInterviewMysql,
  ): Promise<SandboxReport | null> {
    const primaryCode = row.submittedCode?.trim() || null;
    const flaws = Array.isArray(row.architecturalFlaws)
      ? row.architecturalFlaws.filter((item): item is string => typeof item === 'string')
      : [];
    const codeQuality = row.codeQualityScore ?? null;

    let assessmentTitle: string | null = null;
    let attemptScore: number | null = null;
    let submittedAt: string | null = null;
    let submissions: SandboxSubmissionSummary[] = [];

    if (row.candidateAssessmentId) {
      try {
        const attempt = await this.assessmentExecution.getAttempt(
          row.candidateAssessmentId,
        );
        assessmentTitle = attempt.assessment?.title ?? null;
        attemptScore =
          attempt.score != null && attempt.score !== ''
            ? Number(attempt.score)
            : null;
        submittedAt = attempt.submittedAt
          ? new Date(attempt.submittedAt).toISOString()
          : null;

        const fullSubs = await this.executionRepo.getSubmissionsForAttempt(
          row.candidateAssessmentId,
        );
        submissions = fullSubs.map((submission) => {
          const { passed, total } = this.parseTestCounts(
            submission.executionOutput,
          );
          return {
            questionId: submission.questionId,
            language: submission.language,
            sourceCode: submission.sourceCode ?? '',
            score:
              submission.score != null && submission.score !== ''
                ? Number(submission.score)
                : null,
            executionTimeMs: submission.executionTime ?? null,
            status: submission.status ?? null,
            passedTestCases: passed,
            totalTestCases: total,
          };
        });
      } catch (err) {
        this.logger.debug(
          `Sandbox enrichment skipped for ${row.candidateToken}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const bestSubmission =
      submissions.find((entry) => entry.sourceCode.trim()) ?? submissions[0];
    const sourceCode = primaryCode ?? bestSubmission?.sourceCode?.trim() ?? null;
    const language = bestSubmission?.language ?? null;
    const passedTestCases = submissions.reduce(
      (sum, entry) => sum + entry.passedTestCases,
      0,
    );
    const totalTestCases = submissions.reduce(
      (sum, entry) => sum + entry.totalTestCases,
      0,
    );
    const hasSubmission =
      Boolean(sourceCode) ||
      submissions.some((entry) => entry.sourceCode.trim());

    if (!hasSubmission && codeQuality == null && flaws.length === 0) {
      return null;
    }

    return {
      assessmentTitle,
      attemptScore,
      submittedAt,
      language,
      sourceCode,
      codeQualityScore: codeQuality,
      architecturalFlaws: flaws,
      passedTestCases,
      totalTestCases,
      submissions,
      hasSubmission,
    };
  }

  private async enrichToken(
    token: string,
    reportFilename?: string,
  ): Promise<InterviewReportEnrichment | null> {
    const row = await this.repo.findByTokenForAdmin(token);
    if (!row) return null;
    const sandbox = await this.buildSandboxReport(row);
    const integrity = await this.interviewProctor.getProctorReportData({
      candidateToken: row.candidateToken,
      consentRecordedAt: row.consentRecordedAt,
      identityVerifiedAt: row.identityVerifiedAt,
      referenceFaceDescriptor: row.referenceFaceDescriptor,
      livenessVerifiedAt: row.livenessVerifiedAt,
      voiceReferenceEmbedding: row.voiceReferenceEmbedding,
      proctorSummary: row.proctorSummary,
    });
    const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const portalFromMeta =
      typeof meta.portalToken === 'string' && meta.portalToken.trim()
        ? meta.portalToken.trim()
        : null;
    const portalOrSession =
      portalFromMeta ||
      (token.startsWith('demo_') || token.startsWith('app_') ? token : row.candidateToken);

    let recordings: InterviewRecordingView[] = [];
    try {
      // Build & Defend uses separate session tokens but shares portalToken — list by
      // application so both Build and Defend track recordings appear on the report.
      recordings = await this.recordings.listForApplication(portalOrSession);
    } catch (err) {
      this.logger.warn(
        `Recording list failed token=${row.candidateToken}: ${err instanceof Error ? err.message : String(err)}`,
      );
      recordings = [];
    }

    // Filter recordings to only show tracks belonging to the current report round.
    // Each round (screening, build+defend, behavioural) should only display its own recordings.
    if (reportFilename && recordings.length > 0) {
      const allowedPhases = this.resolveAllowedPhasesForReport(reportFilename, row);
      if (allowedPhases.length > 0) {
        const filtered = recordings.filter((r) => allowedPhases.includes(r.phase));
        // Only apply filter if it produces results; otherwise fall back to all.
        if (filtered.length > 0) {
          recordings = filtered;
        }
      }
    }

    const newest = [...recordings].reverse().find((r) => r.playbackUrl);
    const recordingUrl =
      newest?.playbackUrl ?? (await toRecordingPlaybackUrl(`recordings/${row.candidateToken}/final.mp4`));
    return {
      stage1VoiceScore: row.stage1VoiceScore ?? null,
      submittedCode: row.submittedCode ?? null,
      codeQualityScore: row.codeQualityScore ?? null,
      architecturalFlaws: row.architecturalFlaws ?? null,
      currentPhase: row.currentPhase ?? null,
      candidateAssessmentId: row.candidateAssessmentId ?? null,
      finalDecision: row.finalDecision ?? null,
      recordingUrl,
      recordings,
      sandbox,
      hrVoiceAudit:
        row.hrVoiceAudit && typeof row.hrVoiceAudit === 'object'
          ? (row.hrVoiceAudit as Record<string, unknown>)
          : null,
      screeningVoiceAudit:
        row.screeningVoiceAudit && typeof row.screeningVoiceAudit === 'object'
          ? (row.screeningVoiceAudit as Record<string, unknown>)
          : null,
      integrity,
    };
  }

  /**
   * Determine which recording phases are relevant for a given report type.
   * Returns empty array when no filtering should be applied.
   */
  private resolveAllowedPhasesForReport(
    reportFilename: string,
    row: CandidateAutonomousInterviewMysql | null,
  ): string[] {
    const proctor = (row?.proctorSummary as Record<string, unknown> | null) ?? {};
    const stageType = String(proctor.stageType ?? '');
    // AI Verbal clips live on intro_verbal tracks. Do not swap them for Build/Defend.
    if (stageType === 'ai_verbal') return ['verbal'];

    if (reportFilename === 'db:screening_voice_audit') {
      return ['screening'];
    }
    if (reportFilename === 'db:hr_voice_audit' || reportFilename === 'db:session_fallback') {
      const isBehavioral =
        !!proctor.isBehavioral || String(proctor.stageType ?? '') === 'hr_verbal';
      // Behavioural sessions that ran in the defend slot use defend recordings.
      if (isBehavioral) return ['defend', 'other'];
      return ['build', 'defend'];
    }
    if (reportFilename === 'db:stage1_voice_audit') {
      const phase = String(row?.currentPhase ?? '');
      // AI Verbal keeps its own track set. Build & Defend still uses build + defend.
      if (
        stageType === 'ai_verbal' ||
        stageType === 'screening' ||
        phase === 'intro_verbal'
      ) {
        return ['verbal'];
      }
      return ['build', 'defend'];
    }
    // File-based reports (audit_logs) — show build + defend by default.
    return ['build', 'defend'];
  }

  async getReport(token: string, filename?: string): Promise<InterviewReportResponse> {
    let row = await this.repo.findByTokenForAdmin(token);

    // Portal/demo tokens are application shells — resolve to the LiveKit ses_ round.
    if (!this.hasReportableAudit(row) && (token.startsWith('demo_') || !token.startsWith('ses_'))) {
      const resolved = await this.resolveSessionForPortalToken(token);
      if (resolved) {
        row = resolved;
      }
    }

    const reportToken = row?.candidateToken ?? token;
    const dbAudit =
      row?.stage1VoiceAudit && typeof row.stage1VoiceAudit === 'object'
        ? (row.stage1VoiceAudit as Record<string, unknown>)
        : null;

    const all = await this.listAllSummaries();
    let versions = all.filter(
      (r) => r.token === reportToken || r.token === token,
    );

    if (!versions.length && dbAudit && row) {
      const dbVersion = this.dbAuditAsSummary(row);
      if (dbVersion) versions = [dbVersion];
    }

    if (row) {
      const hrVersion = this.dbHrAuditAsSummary(row);
      if (hrVersion && !versions.some((v) => v.filename === hrVersion.filename)) {
        versions = [...versions, hrVersion];
      }
      const screeningVersion = this.dbScreeningAuditAsSummary(row);
      if (screeningVersion && !versions.some((v) => v.filename === screeningVersion.filename)) {
        versions = [...versions, screeningVersion];
      }
      if (!versions.length && hrVersion) {
        versions = [hrVersion];
      } else if (!versions.length && screeningVersion) {
        versions = [screeningVersion];
      }
    }

    // Session exists (recording / chat) but no formal audit JSON yet — still open the page.
    if (!versions.length && row) {
      const sessionVersion = this.dbSessionFallbackSummary(row);
      if (sessionVersion) versions = [sessionVersion];
    }

    if (row) {
      try {
        const resolved = await this.resumeSkills.resolveForInterview(row);
        for (const v of versions) {
          v.candidateName = resolved.candidateName || null;
        }
      } catch (err) {
        this.logger.debug(`Could not resolve candidate name for ${reportToken}: ${err}`);
      }
    }

    if (!versions.length) {
      throw new NotFoundException(`No audit reports found for token: ${token}`);
    }

    const selected =
      filename != null
        ? versions.find((v) => v.filename === filename)
        : this.preferAuditVersion(versions, row);
    if (!selected) {
      throw new NotFoundException(`Audit file not found: ${filename}`);
    }

    // Enrich with the selected report filename so recordings are filtered by round type.
    const enrichToken = row?.candidateToken ?? token;
    let enrichment = await this.enrichToken(enrichToken, selected.filename);

    let report: Record<string, unknown>;
    if (selected.filename === 'db:stage1_voice_audit') {
      if (!dbAudit) {
        throw new NotFoundException(`DB voice audit not found for token: ${token}`);
      }
      report = { ...dbAudit };
      const existingTurns = Array.isArray(report.turns) ? report.turns : [];
      const hasSpoken = existingTurns.some((turn) => {
        const item = (turn && typeof turn === 'object' ? turn : {}) as Record<string, unknown>;
        return (
          String(item.question_asked ?? item.question_text ?? '').trim() ||
          String(item.candidate_reply ?? item.content ?? '').trim()
        );
      });
      if (!hasSpoken && row) {
        let turns = this.chatHistoryToInterviewTurns(row.stage1ChatHistory);
        if (!turns.length) {
          turns = this.chatHistoryToInterviewTurns(row.stage3ChatHistory);
        }
        if (turns.length) report = { ...report, turns };
      }
    } else if (selected.filename === 'db:hr_voice_audit') {
      const hr =
        row?.hrVoiceAudit && typeof row.hrVoiceAudit === 'object'
          ? (row.hrVoiceAudit as Record<string, unknown>)
          : null;
      if (!hr) {
        throw new NotFoundException(`DB HR voice audit not found for token: ${token}`);
      }
      let turns = this.normalizeHrTurnsToInterviewTurns(hr);
      const hasSpoken = turns.some(
        (t) =>
          String(t.question_asked ?? '').trim() || String(t.candidate_reply ?? '').trim(),
      );
      if (!hasSpoken) {
        turns = this.chatHistoryToInterviewTurns(row?.stage3ChatHistory);
        if (!turns.length) {
          turns = this.chatHistoryToInterviewTurns(row?.stage1ChatHistory);
        }
      }
      report = {
        session_id: reportToken,
        tech_stack: 'AI Behavioural',
        resume_skills: [],
        covered_topics: Array.isArray((hr.plan as { covered_topics?: unknown })?.covered_topics)
          ? ((hr.plan as { covered_topics: string[] }).covered_topics)
          : [],
        skipped_topics: [],
        turns,
        depth_score:
          typeof hr.weighted_competency_score === 'number'
            ? Number(hr.weighted_competency_score)
            : 0,
        provider_summary: {},
        finalized_at: row?.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        resume_alignment: {
          resume_skills: [],
          verified: [],
          skipped_due_to_struggles: [],
          un_assessed_due_to_time: [],
          per_skill: {},
        },
        rubric_scorecard: this.hrCompetenciesToRubric(hr),
        weighted_overall_10:
          typeof hr.weighted_competency_score === 'number'
            ? Number(hr.weighted_competency_score) * 2
            : null,
        hr_voice_audit: hr,
      };
    } else if (selected.filename === 'db:session_fallback') {
      report = this.buildSessionFallbackReport(reportToken, row!);
    } else if (selected.filename === 'db:screening_voice_audit') {
      const screening =
        row?.screeningVoiceAudit && typeof row.screeningVoiceAudit === 'object'
          ? (row.screeningVoiceAudit as Record<string, unknown>)
          : null;
      if (!screening) {
        throw new NotFoundException(`DB Screening voice audit not found for token: ${token}`);
      }

      const transcript = Array.isArray(screening.transcript) ? screening.transcript : [];
      let coveredTopics: string[] = [];
      const resultObj = screening.screeningResult as Record<string, unknown> | undefined;
      const conversationState = screening.conversationState as Record<string, unknown> | undefined;
      if (conversationState?.topics) {
        const topics = conversationState.topics as Record<string, { status?: string }>;
        coveredTopics = Object.entries(topics)
          .filter(([_, data]) => data?.status === 'COVERED')
          .map(([key]) => key);
      }

      report = {
        session_id: reportToken,
        tech_stack: 'AI Screening',
        resume_skills: [],
        covered_topics: coveredTopics,
        skipped_topics: [],
        turns: this.normalizeScreeningTranscriptToInterviewTurns(transcript as Array<Record<string, unknown>>),
        depth_score: null,
        provider_summary: {},
        finalized_at: row?.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        resume_alignment: {
          resume_skills: [],
          verified: [],
          skipped_due_to_struggles: [],
          un_assessed_due_to_time: [],
          per_skill: {},
        },
        rubric_scorecard: [],
        weighted_overall_10: null,
        screening_voice_audit: screening,
      };
    } else {
      report = await this.readAuditFile(
        path.join(this.auditDir(), selected.filename),
      );
    }

    // Nest DB is authoritative for Final Evaluation scorecard fields.
    report = this.applyDbVoiceAudit(report, dbAudit);

    const resolvedName = versions.find((v) => v.candidateName)?.candidateName;
    if (resolvedName && !report.candidate_name) {
      report = { ...report, candidate_name: resolvedName };
    }

    return {
      report,
      filename: selected.filename,
      enrichment,
      versions,
    };
  }
}

