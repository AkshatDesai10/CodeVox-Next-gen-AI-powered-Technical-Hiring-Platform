import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import {
  AutonomousInterviewPhase,
  CandidateAutonomousInterviewMysql,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import {
  AutonomousInterviewRoundMysql,
  AutonomousInterviewRoundStatus,
  AutonomousInterviewRoundType,
} from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { InterviewRecordingService } from '../autonomous-interview/interview-recording.service';
import { LiveKitService } from '../autonomous-interview/livekit.service';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import { JobProfileMysql } from '../job-profiles/entities/job-profile.mysql.entity';
import {
  JobProfileStageMysql,
  JobStageType,
} from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { generateInterviewToken } from '../job-profiles/job-profiles.util';
import {
  PROJECT_INTERVIEW_SELECTION_COUNTDOWN_SECONDS,
  normalizeProjectInterviewRoundConfig,
  normalizeVivaQuestionSource,
  sanitizeProjectChoiceForCandidate,
  type ProjectChoice,
  type ProjectInterviewRoundConfig,
} from '../job-profiles/project-interview-round.types';
import {
  ProjectInterviewStatus,
  ProjectInterviewSubmissionMysql,
} from './entities/project-interview-submission.mysql.entity';
import {
  emptyRepoSnapshot,
  heuristicProjectProfile,
  ProjectEvaluationService,
  type ProjectProfile,
} from './project-evaluation.service';
import {
  downloadObjectBytes,
  resolveLocalDownloadUrl,
  underUploads,
  uploadBuffer,
} from '../../files/local-storage';
import { buildDownloadZip } from './document-pack.util';
import {
  buildDeterministicDefenseQuestions,
  buildDeterministicExcelDefenseQuestions,
  resolveDefenseQuestions,
  type DefenseQuestion,
  type EvaluationFallbackLevel,
} from './defense-questions.util';
import {
  ExcelGraderService,
  type ExcelEvaluationResult,
} from './excel-grader.service';
import {
  isSafeBranchName,
  normalizeGithubRepoUrl,
  REPO_SNAPSHOT_FETCHER,
  RepoFetchError,
  type RepoSnapshotFetcher,
} from './repo-snapshot.fetcher';

/** Evaluations older than this with no in-process worker are assumed lost (e.g. server restart) and re-run. */
const STALE_EVALUATION_MS = 5 * 60 * 1000;

export type ProjectInterviewPortalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type ProjectStageMeta = {
  scorePct: number | null;
  status: ProjectInterviewStatus;
  selectedProjectId?: string | null;
  /** Defend session has reached COMPLETED. The Build session is completed earlier, on submit. */
  defendCompleted?: boolean;
};

function hasAudit(v: unknown): boolean {
  return v != null && typeof v === 'object' && Object.keys(v as object).length > 0;
}

function contentTypeForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.sql') || lower.endsWith('.txt') || lower.endsWith('.md')) {
    return 'text/plain; charset=utf-8';
  }
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/** Keep a usable extension so the browser does not save an .xlsx body as .zip. */
function ensureDownloadExtension(name: string, submissionType?: string): string {
  const trimmed = name.trim() || 'assessment';
  if (/\.[a-z0-9]{1,8}$/i.test(trimmed)) return trimmed;
  if (submissionType === 'excel_or_pdf') return `${trimmed}.xlsx`;
  return trimmed;
}

@Injectable()
export class ProjectInterviewService {
  private readonly logger = new Logger(ProjectInterviewService.name);
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(ProjectInterviewSubmissionMysql)
    private readonly submissions: Repository<ProjectInterviewSubmissionMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    @InjectRepository(CandidateAutonomousInterviewMysql)
    private readonly interviews: Repository<CandidateAutonomousInterviewMysql>,
    @InjectRepository(AutonomousInterviewRoundMysql)
    private readonly interviewRounds: Repository<AutonomousInterviewRoundMysql>,
    private readonly evaluation: ProjectEvaluationService,
    private readonly excelGrader: ExcelGraderService,
    @Inject(REPO_SNAPSHOT_FETCHER) private readonly repoFetcher: RepoSnapshotFetcher,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ── Assignment ─────────────────────────────────────────────────────────────

  async ensureForApplication(applicationId: string, stageId: string) {
    const existing = await this.submissions.findOne({
      where: { jobApplicationId: applicationId, stageId },
    });
    if (existing) {
      if (existing.inactive === 1) {
        existing.inactive = 0;
        await this.submissions.save(existing);
      }
      return existing;
    }

    const app = await this.applications.findOne({ where: { id: applicationId, inactive: 0 } });
    const stage = await this.stages.findOne({ where: { id: stageId, inactive: 0 } });
    if (!app?.candidateToken || !stage || stage.stageType !== JobStageType.PROJECT_INTERVIEW) {
      return null;
    }
    const row = this.submissions.create({
      id: randomUUID(),
      jobApplicationId: applicationId,
      stageId,
      candidateId: app.candidateId,
      portalToken: app.candidateToken,
      submissionToken: generateInterviewToken(),
      status: ProjectInterviewStatus.PENDING_SUBMISSION,
      configSnapshot: normalizeProjectInterviewRoundConfig(stage.roundConfig) as unknown as Record<
        string,
        unknown
      >,
      inactive: 0,
    });
    return this.submissions.save(row);
  }

  /** Accepts the submission token, or a portal token whose current stage is Build & Defend. */
  async requireByToken(token: string) {
    const t = (token ?? '').trim();
    if (!t) throw new NotFoundException('Project submission not found');
    const direct = await this.submissions.findOne({ where: { submissionToken: t, inactive: 0 } });
    if (direct) return direct;

    const app = await this.applications.findOne({ where: { candidateToken: t, inactive: 0 } });
    if (app?.currentStageId) {
      const row = await this.ensureForApplication(String(app.id), String(app.currentStageId));
      if (row) return row;
    }

    const byPortal = await this.submissions.find({
      where: { portalToken: t, inactive: 0 },
      order: { updatedAt: 'DESC' },
    });
    const open = byPortal.find((row) =>
      row.status === ProjectInterviewStatus.IN_BUILD ||
      row.status === ProjectInterviewStatus.EVALUATING_CODE ||
      row.status === ProjectInterviewStatus.PENDING_SUBMISSION ||
      row.status === ProjectInterviewStatus.READY_FOR_INTERVIEW,
    );
    if (open) return open;
    if (byPortal[0]) return byPortal[0];
    throw new NotFoundException('Project submission not found');
  }

  // ── Candidate flow ─────────────────────────────────────────────────────────

  async getCandidateView(token: string) {
    let row = await this.refresh(await this.requireByToken(token));
    if (!row.selectedProjectId && !row.selectionStartedAt) {
      row.selectionStartedAt = new Date();
      row = await this.submissions.save(row);
    }
    return this.serializeForCandidate(row);
  }

  async selectProject(token: string, projectId: string) {
    const row = await this.refresh(await this.requireByToken(token));
    const config = this.config(row);
    const choice = config.project_choices.find((c) => c.id === projectId);
    if (!choice) throw new BadRequestException('Unknown project choice');

    if (row.selectedProjectId) {
      if (row.selectedProjectId === projectId) {
        if (!row.buildSessionToken) {
          row.buildSessionToken = await this.createBuildSessionSeed(row, choice);
          row.status = ProjectInterviewStatus.IN_BUILD;
          await this.submissions.save(row);
        }
        return this.serializeForCandidate(row);
      }
      throw new ConflictException('Your project choice is locked and cannot be changed.');
    }
    if (row.status !== ProjectInterviewStatus.PENDING_SUBMISSION) {
      throw new BadRequestException(`Cannot select a project while status is ${row.status}`);
    }

    const now = new Date();
    const hours = Math.max(1, config.max_assessment_hours);
    row.selectedProjectId = choice.id;
    row.selectedAt = now;
    if (!row.selectionStartedAt) row.selectionStartedAt = now;
    row.dueAt = new Date(now.getTime() + hours * 3_600_000);
    row.status = ProjectInterviewStatus.IN_BUILD;
    row.buildSessionToken = await this.createBuildSessionSeed(row, choice);
    await this.submissions.save(row);
    return this.serializeForCandidate(row);
  }

  async submit(
    token: string,
    body: { github_url?: string; github_branch?: string },
    file?: Express.Multer.File,
  ) {
    const row = await this.refresh(await this.requireByToken(token));
    if (
      row.status !== ProjectInterviewStatus.IN_BUILD &&
      row.status !== ProjectInterviewStatus.PENDING_SUBMISSION
    ) {
      throw new BadRequestException(`Cannot submit while status is ${row.status}`);
    }
    const choice = this.selectedChoice(row);
    if (!choice) throw new BadRequestException('Select a project before submitting');
    if (choice.submission_type === 'zip_upload') {
      return this.submitZip(row, file);
    }
    if (choice.submission_type === 'excel_or_pdf') {
      return this.submitExcelOrPdf(row, file);
    }
    if (choice.submission_type !== 'github_url') {
      throw new BadRequestException('This project only accepts GitHub repository submissions for now');
    }
    const url = normalizeGithubRepoUrl(body.github_url ?? '');
    if (!url) {
      throw new BadRequestException('Enter a public repository URL like https://github.com/owner/repo');
    }
    const branch = (body.github_branch ?? '').trim() || null;
    if (!isSafeBranchName(branch)) throw new BadRequestException('Invalid branch name');

    // Instant public check (PAT) so private/404 repos never enter evaluating_code.
    if (typeof this.repoFetcher.assertPublicGithubRepo === 'function') {
      try {
        await this.repoFetcher.assertPublicGithubRepo(url);
      } catch (err) {
        const msg = err instanceof RepoFetchError ? err.message : 'Could not verify the repository.';
        throw new BadRequestException(msg);
      }
    }

    row.githubUrl = url;
    row.githubBranch = branch;
    row.submittedAt = new Date();
    row.lastError = null;
    row.status = ProjectInterviewStatus.EVALUATING_CODE;
    await this.submissions.save(row);

    await this.stopBuildSession(row.buildSessionToken);

    const view = await this.serializeForCandidate(row);
    void this.runEvaluation(row.id);
    return view;
  }

  private async submitZip(row: ProjectInterviewSubmissionMysql, file?: Express.Multer.File) {
    const name = (file?.originalname ?? '').toLowerCase();
    if (!file?.buffer?.length || !name.endsWith('.zip')) {
      throw new BadRequestException('Upload a .zip of your SQL, write-ups, and other text files.');
    }
    if (file.size > 50 * 1024 * 1024) {
      throw new BadRequestException('Zip must be 50MB or smaller.');
    }
    const key = underUploads(
      'project-interview',
      'submissions',
      row.id,
      `${Date.now()}.zip`,
    );
    let url: string;
    try {
      url = await uploadBuffer({
        key,
        body: file.buffer,
        contentType: 'application/zip',
      });
    } catch (err) {
      this.logger.warn(`Zip upload failed for ${row.id}: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException('Could not store the zip. Please try again.');
    }

    row.submissionZipUrl = url;
    row.submissionFileFormat = 'zip';
    row.githubUrl = null;
    row.githubBranch = null;
    row.submittedAt = new Date();
    row.lastError = null;
    row.status = ProjectInterviewStatus.EVALUATING_CODE;
    await this.submissions.save(row);
    await this.stopBuildSession(row.buildSessionToken);
    const view = await this.serializeForCandidate(row);
    void this.runEvaluation(row.id);
    return view;
  }

  private async submitExcelOrPdf(row: ProjectInterviewSubmissionMysql, file?: Express.Multer.File) {
    const name = (file?.originalname ?? '').toLowerCase();
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');
    const isPdf = name.endsWith('.pdf');
    if (!file?.buffer?.length || (!isXlsx && !isPdf)) {
      throw new BadRequestException('Upload your completed workbook (.xlsx) or PDF.');
    }
    if (file.size > 25 * 1024 * 1024) {
      throw new BadRequestException('File must be 25MB or smaller.');
    }
    const format = isPdf ? 'pdf' : 'xlsx';
    const ext = isPdf ? 'pdf' : 'xlsx';
    const key = underUploads('project-interview', 'submissions', row.id, `${Date.now()}.${ext}`);
    let url: string;
    try {
      url = await uploadBuffer({
        key,
        body: file.buffer,
        contentType:
          file.mimetype ||
          (isPdf
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      });
    } catch (err) {
      this.logger.warn(
        `Excel/PDF upload failed for ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
      throw new BadRequestException('Could not store the file. Please try again.');
    }

    row.submissionZipUrl = url;
    row.submissionFileFormat = format;
    row.githubUrl = null;
    row.githubBranch = null;
    row.submittedAt = new Date();
    row.lastError = null;
    row.excelEvaluationSummary = null;
    row.status = ProjectInterviewStatus.EVALUATING_CODE;
    await this.submissions.save(row);
    await this.stopBuildSession(row.buildSessionToken);
    const view = await this.serializeForCandidate(row);
    void this.runEvaluation(row.id);
    return view;
  }

  /**
   * EVALUATING_CODE → READY_FOR_INTERVIEW.
   * Never loops the candidate back to IN_BUILD on clone/LLM failure — uses triple-tier
   * defense questions and locks them before the Defend session starts.
   */
  async runEvaluation(submissionId: string): Promise<void> {
    if (this.running.has(submissionId)) return;
    this.running.add(submissionId);
    try {
      let row = await this.submissions.findOne({ where: { id: submissionId, inactive: 0 } });
      if (!row) return;
      // Score-only path when questions are already locked (force-advance or re-score mid-flight).
      if (
        row.interviewQuestionsLocked &&
        row.status !== ProjectInterviewStatus.EVALUATING_CODE
      ) {
        await this.mergeBackgroundCodeScores(row);
        return;
      }
      if (row.status !== ProjectInterviewStatus.EVALUATING_CODE) return;
      const choice = this.selectedChoice(row);
      if (!choice) {
        // Only true hard stop: project config missing.
        row.lastError = 'Selected project is no longer available.';
        row.status = ProjectInterviewStatus.IN_BUILD;
        await this.submissions.save(row);
        return;
      }

      if (choice.submission_type === 'excel_or_pdf') {
        await this.runExcelOrPdfEvaluation(row, choice, submissionId);
        return;
      }

      const documentPack = Boolean(row.submissionZipUrl);
      if (!documentPack && !row.githubUrl) {
        await this.advanceWithFallback(row, 'No repository or zip was attached.');
        return;
      }

      let snapshot: Awaited<ReturnType<ProjectEvaluationService['evaluate']>>['snapshot'] | null =
        null;
      let profile: ProjectProfile | null = null;
      let fallbackLevel: EvaluationFallbackLevel = 'AST_PRIMARY';

      try {
        let result: Awaited<ReturnType<ProjectEvaluationService['evaluate']>>;
        if (documentPack && row.submissionZipUrl) {
          const downloaded = await downloadObjectBytes({ storagePath: row.submissionZipUrl });
          if (!downloaded?.buffer?.length) {
            throw new RepoFetchError('The uploaded zip could not be read.');
          }
          result = await this.evaluation.evaluateDocumentPack({
            project: choice,
            zipBuffer: downloaded.buffer,
          });
        } else {
          result = await this.evaluation.evaluate({
            project: choice,
            repoUrl: row.githubUrl!,
            branch: row.githubBranch,
          });
        }
        snapshot = result.snapshot;
        profile = result.profile;
        fallbackLevel = profile.generated_by === 'llm' ? 'AST_PRIMARY' : 'DETERMINISTIC_STATIC';
      } catch (err) {
        this.logger.warn(
          `Project evaluation primary path failed for ${row.id}: ${err instanceof Error ? err.message : err}`,
        );
        row.lastError =
          err instanceof RepoFetchError
            ? err.message
            : documentPack
              ? 'Zip grading failed; continuing with defense questions.'
              : 'Repo grading failed; continuing with defense questions.';
        // Secondary: metadata LLM questions; tertiary: deterministic (inside synthesize).
        const metaQs = await this.evaluation.synthesizeMetadataDefenseQuestions(
          choice,
          this.config(row).ai_interviewer.question_count,
        );
        const deterministic = buildDeterministicDefenseQuestions(choice);
        const isDeterministic =
          metaQs.length === deterministic.length &&
          metaQs.every((q, i) => q.question === deterministic[i]?.question);
        fallbackLevel = isDeterministic ? 'DETERMINISTIC_STATIC' : 'LLM_METADATA';
        snapshot = emptyRepoSnapshot(row.githubUrl ?? 'zip-upload', row.githubBranch);
        profile = heuristicProjectProfile(choice, snapshot, row.lastError ?? undefined);
        profile.suggested_questions = metaQs;
      }

      // Re-load in case force-advance locked questions while we were evaluating.
      row = (await this.submissions.findOne({ where: { id: submissionId, inactive: 0 } })) ?? row;
      if (row.interviewQuestionsLocked) {
        await this.mergeScoresOntoLockedRow(row, snapshot, profile);
        return;
      }

      this.applyQuestionLock(row, choice, profile!, fallbackLevel);
      row.repoSnapshot = (snapshot ?? emptyRepoSnapshot(row.githubUrl ?? '', row.githubBranch)) as unknown as Record<
        string,
        unknown
      >;
      row.projectProfile = profile as unknown as Record<string, unknown>;
      row.evaluatedAt = new Date();
      row.lastError = null;
      if (!row.interviewToken) {
        row.interviewToken = await this.createDefendSessionSeed(row, choice, profile!);
      }
      row.status = ProjectInterviewStatus.READY_FOR_INTERVIEW;
      await this.submissions.save(row);
    } catch (err) {
      this.logger.error(
        `Project evaluation crashed for ${submissionId}: ${err instanceof Error ? err.stack : err}`,
      );
      const row = await this.submissions.findOne({ where: { id: submissionId, inactive: 0 } });
      if (row?.status === ProjectInterviewStatus.EVALUATING_CODE) {
        try {
          await this.advanceWithFallback(row, 'Evaluation failed unexpectedly; using fallback questions.');
        } catch (inner) {
          this.logger.error(
            `Fallback advance also failed for ${submissionId}: ${inner instanceof Error ? inner.message : inner}`,
          );
        }
      }
    } finally {
      this.running.delete(submissionId);
    }
  }

  /** Excel: problem-vs-key cell diff. PDF: soft advance + viva only. */
  private async runExcelOrPdfEvaluation(
    row: ProjectInterviewSubmissionMysql,
    choice: ProjectChoice,
    submissionId: string,
  ): Promise<void> {
    if (!row.submissionZipUrl) {
      await this.advanceWithFallback(row, 'No Excel/PDF file was attached.');
      return;
    }

    const format = (row.submissionFileFormat ?? '').toLowerCase();
    const isPdf = format === 'pdf' || row.submissionZipUrl.toLowerCase().includes('.pdf');
    const snapshot = emptyRepoSnapshot('excel-or-pdf', null);
    const cfg = this.config(row);
    const vivaSource = normalizeVivaQuestionSource(cfg.ai_interviewer?.viva_question_source);
    let profile: ProjectProfile;
    let fallbackLevel: EvaluationFallbackLevel;

    if (isPdf) {
      const qs = await this.evaluation.synthesizeExcelDefenseQuestions({
        project: choice,
        source: vivaSource === 'evaluation' ? 'mix' : vivaSource,
        focusAreas: cfg.ai_interviewer.focus_areas ?? [],
        gapSummary: ['PDF practical — soft / viva-weighted evaluation'],
        hardcodedCells: [],
        questionCount: cfg.ai_interviewer.question_count,
      });
      profile = this.buildPdfSoftProfile(choice, qs);
      fallbackLevel = 'PDF_SOFT';
      row.excelEvaluationSummary = { mode: 'pdf_soft', score_pct: null };
    } else {
      try {
        const [candidateDl, problemDl, keyDl] = await Promise.all([
          downloadObjectBytes({ storagePath: row.submissionZipUrl }),
          choice.assessment_document?.file_url
            ? downloadObjectBytes({ storagePath: choice.assessment_document.file_url })
            : Promise.resolve(null),
          choice.answer_key?.file_url
            ? downloadObjectBytes({ storagePath: choice.answer_key.file_url })
            : Promise.resolve(null),
        ]);
        if (!candidateDl?.buffer?.length) throw new Error('Candidate workbook could not be read.');
        if (!problemDl?.buffer?.length) {
          throw new Error('Problem sheet is missing from the round config.');
        }
        if (!keyDl?.buffer?.length) {
          throw new Error('Master answer key is missing from the round config.');
        }
        const grade = await this.excelGrader.grade({
          problemBuffer: problemDl.buffer,
          answerKeyBuffer: keyDl.buffer,
          candidateBuffer: candidateDl.buffer,
        });
        const qs = await this.evaluation.synthesizeExcelDefenseQuestions({
          project: choice,
          source: vivaSource,
          focusAreas: cfg.ai_interviewer.focus_areas ?? [],
          gapSummary: grade.gap_summary,
          hardcodedCells: grade.hardcoded_cells_detected,
          questionCount: cfg.ai_interviewer.question_count,
        });
        profile = this.buildExcelProjectProfile(choice, grade);
        profile.suggested_questions = qs;
        fallbackLevel = 'EXCEL_KEY';
        row.excelEvaluationSummary = grade as unknown as Record<string, unknown>;
        row.lastError = null;
      } catch (err) {
        this.logger.warn(
          `Excel grading failed for ${row.id}: ${err instanceof Error ? err.message : err}`,
        );
        row.lastError =
          err instanceof Error
            ? `Excel grading failed; continuing with viva. (${err.message.slice(0, 180)})`
            : 'Excel grading failed; continuing with viva.';
        const qs = buildDeterministicExcelDefenseQuestions(choice, [row.lastError]);
        profile = this.buildExcelProjectProfile(choice, {
          score_pct: 0,
          total_checks: 0,
          passed_checks: 0,
          hardcoded_cells_detected: [],
          ignored_sheets: [],
          graded_sheets: [],
          answer_cell_count: 0,
          mistakes: [],
          gap_summary: [row.lastError],
        });
        profile.suggested_questions = qs;
        profile.evaluation_scores.requirements_score_pct = null;
        fallbackLevel = 'DETERMINISTIC_STATIC';
        row.excelEvaluationSummary = {
          mode: 'excel_failed',
          error: err instanceof Error ? err.message.slice(0, 500) : String(err),
        };
      }
    }

    row = (await this.submissions.findOne({ where: { id: submissionId, inactive: 0 } })) ?? row;
    if (isPdf && !row.excelEvaluationSummary) {
      row.excelEvaluationSummary = { mode: 'pdf_soft', score_pct: null };
    }
    if (row.interviewQuestionsLocked) {
      await this.mergeScoresOntoLockedRow(row, snapshot, profile);
      return;
    }

    this.applyQuestionLock(row, choice, profile, fallbackLevel);
    row.repoSnapshot = snapshot as unknown as Record<string, unknown>;
    row.projectProfile = profile as unknown as Record<string, unknown>;
    row.evaluatedAt = new Date();
    if (!isPdf && fallbackLevel === 'EXCEL_KEY') row.lastError = null;
    if (!row.interviewToken) {
      row.interviewToken = await this.createDefendSessionSeed(row, choice, profile);
    }
    row.status = ProjectInterviewStatus.READY_FOR_INTERVIEW;
    await this.submissions.save(row);
  }

  private buildExcelProjectProfile(
    project: ProjectChoice,
    grade: ExcelEvaluationResult,
  ): ProjectProfile {
    const qs = buildDeterministicExcelDefenseQuestions(project, grade.gap_summary);
    // Excel does not use must-have / twist checklists — one grade-derived row only.
    const status = (grade.score_pct >= 90
      ? 'complete'
      : grade.score_pct >= 50
        ? 'partial'
        : 'missing') as 'complete' | 'partial' | 'missing';
    const checklist = [
      {
        id: 'excel_answer_key_grade',
        text: 'Answer cells match master key (problem≠key)',
        weight: 100,
        status,
        score_pct: grade.score_pct,
        passed: grade.score_pct >= 60,
        evidence: grade.gap_summary[0] ?? `Excel key grade ${grade.score_pct}%`,
        reason: `${grade.passed_checks}/${grade.total_checks} answer cells matched`,
      },
    ];
    return {
      task_match: {
        matches: grade.answer_cell_count > 0 || grade.total_checks > 0,
        note: `Excel problem-vs-key grade ${grade.score_pct}%`,
      },
      app_summary: `Excel practical scored ${grade.score_pct}% (${grade.passed_checks}/${grade.total_checks} checks). Sheets: ${grade.graded_sheets.join(', ') || 'none'}.`,
      tech_stack_summary: 'Microsoft Excel',
      architecture_summary: `Answer cells = problem≠key diff (${grade.answer_cell_count} cells).`,
      features: grade.graded_sheets,
      user_roles: [],
      scripts: [],
      key_libraries: [],
      config_highlights: grade.hardcoded_cells_detected.slice(0, 8).map((c) => `Hardcoded: ${c}`),
      data_storage: null,
      evaluation_scores: {
        deliverables: {
          tests_present: false,
          readme_present: false,
          decisions_md_present: false,
          run_instructions_present: false,
        },
        checklist_results: checklist,
        twist_requirement_met: null,
        twist_evidence: '',
        requirements_score_pct: grade.score_pct,
      },
      suggested_questions: qs,
      overclaims: [],
      ownership_flags: [],
      cannot_verify: grade.ignored_sheets.map((s) => `Ignored sheet: ${s}`),
      generated_by: 'heuristic',
    };
  }

  private buildPdfSoftProfile(project: ProjectChoice, questions: DefenseQuestion[]): ProjectProfile {
    return {
      task_match: { matches: true, note: 'PDF practical — scored in Defend viva (soft).' },
      app_summary: `${project.title} submitted as PDF; auto cell-grade not applicable.`,
      tech_stack_summary: 'PDF practical',
      architecture_summary: '',
      features: [],
      user_roles: [],
      scripts: [],
      key_libraries: [],
      config_highlights: [],
      data_storage: null,
      evaluation_scores: {
        deliverables: {
          tests_present: false,
          readme_present: false,
          decisions_md_present: false,
          run_instructions_present: false,
        },
        checklist_results: [
          {
            id: 'pdf_soft_viva',
            text: 'PDF practical — scored in Defend viva',
            weight: 100,
            status: 'missing' as const,
            score_pct: 0,
            passed: null,
            evidence: '',
            reason: 'PDF soft mode — viva-weighted.',
          },
        ],
        twist_requirement_met: null,
        twist_evidence: '',
        requirements_score_pct: null,
      },
      suggested_questions: questions,
      overclaims: [],
      ownership_flags: [],
      cannot_verify: ['PDF auto-grade unavailable; Defend viva carries the practical score.'],
      generated_by: 'heuristic',
    };
  }

  /** Admin / ops: live eval badge + force-advance gate. */
  async getEvalStatus(token: string) {
    const row = await this.resolveAdminSubmission(token);
    const started = row.submittedAt?.getTime() ?? row.updatedAt?.getTime() ?? Date.now();
    const eval_duration_sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const evaluating = row.status === ProjectInterviewStatus.EVALUATING_CODE;
    return {
      status: row.status,
      fallback_active:
        row.evaluationFallbackLevel !== 'NONE' && row.evaluationFallbackLevel !== 'AST_PRIMARY',
      evaluation_fallback_level: row.evaluationFallbackLevel,
      eval_duration_sec,
      can_force_advance: evaluating && eval_duration_sec >= 30,
      interview_token: row.interviewToken,
      interview_questions_locked: Boolean(row.interviewQuestionsLocked),
    };
  }

  /** Push candidate to Defend immediately with locked fallback questions. */
  async forceAdvanceToInterview(token: string) {
    const row = await this.resolveAdminSubmission(token);
    if (
      row.status === ProjectInterviewStatus.READY_FOR_INTERVIEW &&
      row.interviewToken &&
      row.interviewQuestionsLocked
    ) {
      return { success: true, new_status: row.status, already: true };
    }
    if (
      row.status !== ProjectInterviewStatus.EVALUATING_CODE &&
      row.status !== ProjectInterviewStatus.IN_BUILD &&
      row.status !== ProjectInterviewStatus.READY_FOR_INTERVIEW
    ) {
      throw new BadRequestException(`Cannot force-advance while status is ${row.status}`);
    }
    await this.advanceWithFallback(row, 'Force-advanced by recruiter.');
    const fresh = await this.submissions.findOne({ where: { id: row.id, inactive: 0 } });
    // Keep background scoring running if clone/LLM was mid-flight.
    if (fresh?.githubUrl || fresh?.submissionZipUrl) {
      void this.runEvaluation(row.id);
    }
    return {
      success: true,
      new_status: fresh?.status ?? ProjectInterviewStatus.READY_FOR_INTERVIEW,
      interview_token: fresh?.interviewToken ?? null,
    };
  }

  /**
   * Recruiter re-scores code (optional new GitHub URL) without mutating locked defense questions
   * or the verbal defense score.
   */
  async rescoreCode(
    submissionId: string,
    body?: { github_url?: string; github_branch?: string },
  ) {
    const row = await this.submissions.findOne({ where: { id: submissionId, inactive: 0 } });
    if (!row) throw new NotFoundException('Submission not found');
    const choice = this.selectedChoice(row);
    if (!choice) throw new BadRequestException('No project selected on this submission');
    if (choice.submission_type === 'github_url' || body?.github_url) {
      const url = normalizeGithubRepoUrl(body?.github_url ?? row.githubUrl ?? '');
      if (!url) throw new BadRequestException('Enter a public repository URL like https://github.com/owner/repo');
      const branch =
        body?.github_branch !== undefined
          ? (body.github_branch ?? '').trim() || null
          : row.githubBranch;
      if (!isSafeBranchName(branch)) throw new BadRequestException('Invalid branch name');
      if (typeof this.repoFetcher.assertPublicGithubRepo === 'function') {
        try {
          await this.repoFetcher.assertPublicGithubRepo(url);
        } catch (err) {
          throw new BadRequestException(
            err instanceof RepoFetchError ? err.message : 'Could not verify the repository.',
          );
        }
      }
      row.githubUrl = url;
      row.githubBranch = branch;
      await this.submissions.save(row);
    }
    void this.mergeBackgroundCodeScores(row);
    return {
      success: true,
      submission_id: row.id,
      github_url: row.githubUrl,
      message: 'Code re-score started. Verbal defense score is unchanged.',
    };
  }

  private async resolveAdminSubmission(token: string): Promise<ProjectInterviewSubmissionMysql> {
    const t = (token ?? '').trim();
    if (!t) throw new NotFoundException('Project submission not found');
    const bySession = await this.findByAnySessionToken(t);
    if (bySession) return bySession;
    return this.requireByToken(t);
  }

  private applyQuestionLock(
    row: ProjectInterviewSubmissionMysql,
    choice: ProjectChoice,
    profile: ProjectProfile,
    fallbackLevel: EvaluationFallbackLevel,
  ) {
    if (row.interviewQuestionsLocked) return;
    const want = Math.max(1, this.config(row).ai_interviewer.question_count ?? 5);
    const locked = resolveDefenseQuestions(choice, profile.suggested_questions, want);
    profile.suggested_questions = locked;
    row.lockedDefenseQuestions = locked;
    row.interviewQuestionsLocked = 1;
    row.evaluationFallbackLevel = fallbackLevel;
  }

  private async advanceWithFallback(row: ProjectInterviewSubmissionMysql, note: string) {
    const choice = this.selectedChoice(row);
    if (!choice) throw new BadRequestException('Selected project is no longer available.');

    let profile = (row.projectProfile ?? null) as ProjectProfile | null;
    let fallbackLevel: EvaluationFallbackLevel =
      (row.evaluationFallbackLevel as EvaluationFallbackLevel) || 'DETERMINISTIC_STATIC';

    if (!row.interviewQuestionsLocked) {
      let locked: DefenseQuestion[];
      try {
        if (choice.submission_type === 'excel_or_pdf') {
          const cfg = this.config(row);
          locked = await this.evaluation.synthesizeExcelDefenseQuestions({
            project: choice,
            source: normalizeVivaQuestionSource(cfg.ai_interviewer?.viva_question_source),
            focusAreas: cfg.ai_interviewer.focus_areas ?? [],
            gapSummary: [],
            hardcodedCells: [],
            questionCount: cfg.ai_interviewer.question_count,
          });
          fallbackLevel = 'LLM_METADATA';
        } else {
          locked = await this.evaluation.synthesizeMetadataDefenseQuestions(
            choice,
            this.config(row).ai_interviewer.question_count,
          );
          const deterministic = buildDeterministicDefenseQuestions(choice);
          const isDeterministic =
            locked.length === deterministic.length &&
            locked.every((q, i) => q.question === deterministic[i]?.question);
          fallbackLevel = isDeterministic ? 'DETERMINISTIC_STATIC' : 'LLM_METADATA';
        }
      } catch {
        locked =
          choice.submission_type === 'excel_or_pdf'
            ? buildDeterministicExcelDefenseQuestions(choice)
            : buildDeterministicDefenseQuestions(choice);
        fallbackLevel = 'DETERMINISTIC_STATIC';
      }
      const snapshot = emptyRepoSnapshot(row.githubUrl ?? 'unavailable', row.githubBranch);
      if (!profile) {
        profile = heuristicProjectProfile(choice, snapshot, note);
      }
      profile.suggested_questions = locked;
      this.applyQuestionLock(row, choice, profile, fallbackLevel);
      if (!row.repoSnapshot) {
        row.repoSnapshot = snapshot as unknown as Record<string, unknown>;
      }
      row.projectProfile = profile as unknown as Record<string, unknown>;
    }

    if (!row.interviewToken) {
      row.interviewToken = await this.createDefendSessionSeed(
        row,
        choice,
        (row.projectProfile as unknown as ProjectProfile) ??
          heuristicProjectProfile(choice, emptyRepoSnapshot(row.githubUrl ?? '', row.githubBranch)),
      );
    }
    row.evaluatedAt = row.evaluatedAt ?? new Date();
    row.lastError = note;
    row.status = ProjectInterviewStatus.READY_FOR_INTERVIEW;
    await this.submissions.save(row);
  }

  /** Background code score update that never mutates locked_defense_questions. */
  private async mergeBackgroundCodeScores(row: ProjectInterviewSubmissionMysql): Promise<void> {
    if (this.running.has(`score:${row.id}`)) return;
    this.running.add(`score:${row.id}`);
    try {
      const choice = this.selectedChoice(row);
      if (!choice) return;
      if (choice.submission_type === 'excel_or_pdf') {
        if (!row.submissionZipUrl || (row.submissionFileFormat ?? '') === 'pdf') return;
        const [candidateDl, problemDl, keyDl] = await Promise.all([
          downloadObjectBytes({ storagePath: row.submissionZipUrl }),
          choice.assessment_document?.file_url
            ? downloadObjectBytes({ storagePath: choice.assessment_document.file_url })
            : Promise.resolve(null),
          choice.answer_key?.file_url
            ? downloadObjectBytes({ storagePath: choice.answer_key.file_url })
            : Promise.resolve(null),
        ]);
        if (!candidateDl?.buffer?.length || !problemDl?.buffer?.length || !keyDl?.buffer?.length) {
          return;
        }
        const grade = await this.excelGrader.grade({
          problemBuffer: problemDl.buffer,
          answerKeyBuffer: keyDl.buffer,
          candidateBuffer: candidateDl.buffer,
        });
        const profile = this.buildExcelProjectProfile(choice, grade);
        const fresh = await this.submissions.findOne({ where: { id: row.id, inactive: 0 } });
        if (!fresh) return;
        fresh.excelEvaluationSummary = grade as unknown as Record<string, unknown>;
        await this.mergeScoresOntoLockedRow(fresh, emptyRepoSnapshot('excel-or-pdf', null), profile);
        return;
      }
      const documentPack = Boolean(row.submissionZipUrl);
      if (!documentPack && !row.githubUrl) return;

      let result: Awaited<ReturnType<ProjectEvaluationService['evaluate']>>;
      if (documentPack && row.submissionZipUrl) {
        const downloaded = await downloadObjectBytes({ storagePath: row.submissionZipUrl });
        if (!downloaded?.buffer?.length) return;
        result = await this.evaluation.evaluateDocumentPack({
          project: choice,
          zipBuffer: downloaded.buffer,
        });
      } else {
        result = await this.evaluation.evaluate({
          project: choice,
          repoUrl: row.githubUrl!,
          branch: row.githubBranch,
        });
      }
      const fresh = await this.submissions.findOne({ where: { id: row.id, inactive: 0 } });
      if (!fresh) return;
      await this.mergeScoresOntoLockedRow(fresh, result.snapshot, result.profile);
    } catch (err) {
      this.logger.warn(
        `Background code re-score failed for ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running.delete(`score:${row.id}`);
    }
  }

  private async mergeScoresOntoLockedRow(
    row: ProjectInterviewSubmissionMysql,
    snapshot: Awaited<ReturnType<ProjectEvaluationService['evaluate']>>['snapshot'] | null,
    profile: ProjectProfile | null,
  ) {
    if (!profile) return;
    const existing = (row.projectProfile ?? {}) as Record<string, unknown>;
    const lockedQs = row.lockedDefenseQuestions;
    const merged: Record<string, unknown> = {
      ...existing,
      ...profile,
      evaluation_scores: profile.evaluation_scores,
      // Preserve locked question text on the profile copy used by reports.
      suggested_questions: lockedQs ?? profile.suggested_questions ?? existing.suggested_questions,
      generated_by: profile.generated_by,
    };
    row.projectProfile = merged;
    if (snapshot && (snapshot.file_count ?? 0) > 0) {
      row.repoSnapshot = snapshot as unknown as Record<string, unknown>;
    }
    row.evaluatedAt = new Date();
    // Never unlock or change locked_defense_questions / interview_questions_locked.
    if (
      row.status === ProjectInterviewStatus.EVALUATING_CODE &&
      row.interviewQuestionsLocked &&
      row.interviewToken
    ) {
      row.status = ProjectInterviewStatus.READY_FOR_INTERVIEW;
    }
    await this.submissions.save(row);
  }

  private async stopBuildSession(buildSessionToken: string | null) {
    if (!buildSessionToken) return;
    try {
      await this.interviews.update(
        { candidateToken: buildSessionToken },
        { currentPhase: AutonomousInterviewPhase.COMPLETED },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to mark Build session complete ${buildSessionToken}: ${err instanceof Error ? err.message : err}`,
      );
    }
    // Egress listing and room delete can take many seconds. The candidate's
    // Leave request must not wait on them, or the page sits on "Reconnect".
    void this.releaseBuildRoom(buildSessionToken);
  }

  private async releaseBuildRoom(buildSessionToken: string) {
    try {
      const recordings = this.moduleRef.get(InterviewRecordingService, { strict: false });
      if (recordings?.syncTrackEgresses && recordings?.stopActive) {
        await recordings.syncTrackEgresses(buildSessionToken, { force: true });
        await recordings.stopActive(buildSessionToken);
        for (const delayMs of [0, 15_000, 60_000]) {
          setTimeout(() => {
            void recordings.syncTrackEgresses(buildSessionToken, { force: true }).catch((err) => {
              this.logger.warn(
                `Build track sync failed token=${buildSessionToken}: ${err instanceof Error ? err.message : err}`,
              );
            });
          }, delayMs);
        }
      }
    } catch {
      this.logger.warn(`InterviewRecordingService unavailable while stopping Build ${buildSessionToken}`);
    }
    try {
      const livekit = this.moduleRef.get(LiveKitService, { strict: false });
      if (typeof livekit?.deleteRoom === 'function') {
        await livekit.deleteRoom(`${buildSessionToken}_bnd_assessment`);
      }
    } catch {
      this.logger.warn(`LiveKit room delete unavailable for Build ${buildSessionToken}`);
    }
  }

  private async createBuildSessionSeed(
    row: ProjectInterviewSubmissionMysql,
    choice: ProjectChoice,
  ): Promise<string> {
    const app = await this.applications.findOne({ where: { id: row.jobApplicationId } });
    const jobProfile = app
      ? await this.profiles.findOne({ where: { id: app.jobProfileId } })
      : null;
    const candidate = await this.candidates.findOne({ where: { id: row.candidateId } });
    const token = 'ses_' + randomBytes(16).toString('hex');
    const config = this.config(row);
    const techStack = (
      choice.tech_stack.languages_frameworks[0] ||
      jobProfile?.requiredSkills?.[0] ||
      'General'
    ).slice(0, 100);

    await this.interviews.save(
      this.interviews.create({
        candidateToken: token,
        jobProfileId: app?.jobProfileId ?? null,
        isPreview: 0,
        currentPhase: AutonomousInterviewPhase.BND_ASSESSMENT,
        techStack,
        resumeSkills: candidate?.skills ?? jobProfile?.requiredSkills ?? [],
        proctorSummary: {
          portalToken: row.portalToken,
          isBehavioral: false,
          stageId: String(row.stageId),
          stageType: JobStageType.PROJECT_INTERVIEW,
          bndPhase: 'build',
          projectSubmissionId: row.id,
          projectSubmissionToken: row.submissionToken,
          maxAssessmentHours: config.max_assessment_hours,
          selectedProjectId: choice.id,
        },
      } as Partial<CandidateAutonomousInterviewMysql>),
    );
    return token;
  }

  private async createDefendSessionSeed(
    row: ProjectInterviewSubmissionMysql,
    choice: ProjectChoice,
    profile: ProjectProfile,
  ): Promise<string> {
    const app = await this.applications.findOne({ where: { id: row.jobApplicationId } });
    const jobProfile = app
      ? await this.profiles.findOne({ where: { id: app.jobProfileId } })
      : null;
    const candidate = await this.candidates.findOne({ where: { id: row.candidateId } });
    const token = 'ses_' + randomBytes(16).toString('hex');
    const techStack = (
      choice.tech_stack.languages_frameworks[0] ||
      profile.key_libraries[0]?.name ||
      jobProfile?.requiredSkills?.[0] ||
      'General'
    ).slice(0, 100);

    await this.interviews.save(
      this.interviews.create({
        candidateToken: token,
        jobProfileId: app?.jobProfileId ?? null,
        isPreview: 0,
        currentPhase: AutonomousInterviewPhase.BND_INTERVIEW,
        techStack,
        resumeSkills: candidate?.skills ?? jobProfile?.requiredSkills ?? [],
        proctorSummary: {
          portalToken: row.portalToken,
          isBehavioral: false,
          stageId: String(row.stageId),
          stageType: JobStageType.PROJECT_INTERVIEW,
          bndPhase: 'defend',
          projectSubmissionId: row.id,
          projectSubmissionToken: row.submissionToken,
        },
      } as Partial<CandidateAutonomousInterviewMysql>),
    );
    return token;
  }

  /**
   * Explicit Leave Build before a GitHub URL exists.
   * Idempotent. Does not run repo evaluation and does not create a Defend session.
   * If a submission is already in flight, the database state wins.
   */
  async leaveBuildWithoutSubmission(sessionToken: string) {
    const located = await this.findByAnySessionToken(sessionToken);
    if (!located) {
      return { finalized: false, reason: 'not_found' as const };
    }
    const row = await this.submissions.findOne({ where: { id: located.id, inactive: 0 } });
    if (!row) return { finalized: false, reason: 'not_found' as const };

    if (row.status === ProjectInterviewStatus.COMPLETED) {
      await this.stopBuildSession(row.buildSessionToken);
      return { finalized: true, idempotent: true, status: row.status, build_score_pct: 0, defend_score_pct: 0 };
    }
    if (
      row.githubUrl ||
      row.submissionZipUrl ||
      row.status === ProjectInterviewStatus.EVALUATING_CODE ||
      row.status === ProjectInterviewStatus.READY_FOR_INTERVIEW
    ) {
      return {
        finalized: false,
        reason: 'submission_already_started' as const,
        status: row.status,
      };
    }

    const profile = (row.projectProfile ?? {}) as Record<string, unknown>;
    row.status = ProjectInterviewStatus.COMPLETED;
    row.evaluatedAt = new Date();
    row.interviewToken = null;
    row.projectProfile = {
      ...profile,
      early_end_without_submission: true,
      evaluation_scores: {
        requirements_score_pct: 0,
        defend_skipped: true,
        defend_score_pct: 0,
      },
    };
    await this.submissions.save(row);
    await this.stopBuildSession(row.buildSessionToken);
    return {
      finalized: true,
      status: row.status,
      build_score_pct: 0,
      defend_score_pct: 0,
    };
  }

  /** Lazily applies time/interview-driven transitions. */
  private async refresh(row: ProjectInterviewSubmissionMysql) {
    const now = Date.now();
    // Before submit: keep Build brief in sync with recruiter edits (e.g. GitHub → Excel).
    if (
      !row.submittedAt &&
      (row.status === ProjectInterviewStatus.PENDING_SUBMISSION ||
        row.status === ProjectInterviewStatus.IN_BUILD)
    ) {
      try {
        const stage = await this.stages.findOne({ where: { id: row.stageId, inactive: 0 } });
        if (stage?.roundConfig) {
          const next = normalizeProjectInterviewRoundConfig(stage.roundConfig);
          const prev = JSON.stringify(row.configSnapshot ?? null);
          const nextJson = JSON.stringify(next);
          if (prev !== nextJson) {
            row.configSnapshot = next as unknown as Record<string, unknown>;
            await this.submissions.save(row);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Could not refresh config snapshot for ${row.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (
      (row.status === ProjectInterviewStatus.IN_BUILD ||
        (row.status === ProjectInterviewStatus.PENDING_SUBMISSION && row.selectedProjectId)) &&
      row.dueAt &&
      row.dueAt.getTime() < now
    ) {
      row.status = ProjectInterviewStatus.EXPIRED;
      await this.submissions.save(row);
    } else if (row.status === ProjectInterviewStatus.READY_FOR_INTERVIEW && row.interviewToken) {
      const interview = await this.interviews.findOne({
        where: { candidateToken: row.interviewToken },
      });
      if (
        interview &&
        interview.currentPhase === AutonomousInterviewPhase.COMPLETED
      ) {
        row.status = ProjectInterviewStatus.COMPLETED;
        await this.submissions.update({ id: row.id }, { status: row.status });
      }
    } else if (
      row.status === ProjectInterviewStatus.EVALUATING_CODE &&
      !this.running.has(row.id) &&
      row.submittedAt &&
      now - row.submittedAt.getTime() > STALE_EVALUATION_MS
    ) {
      void this.runEvaluation(row.id);
    }
    return row;
  }

  // ── Integration helpers ────────────────────────────────────────────────────

  async getPortalStatus(applicationId: string, stageId: string): Promise<ProjectInterviewPortalStatus> {
    const row = await this.submissions.findOne({
      where: { jobApplicationId: applicationId, stageId, inactive: 0 },
    });
    if (!row) return 'NOT_STARTED';
    const fresh = await this.refresh(row);
    if (fresh.status === ProjectInterviewStatus.COMPLETED) return 'COMPLETED';
    return fresh.selectedProjectId ? 'IN_PROGRESS' : 'NOT_STARTED';
  }

  /** Candidate has heard the Defend thank-you. Scoring is still running. */
  async markFinalEvaluationPending(interviewToken: string) {
    const row = await this.findByAnySessionToken(interviewToken);
    if (!row) return null;
    const profile = { ...((row.projectProfile ?? {}) as Record<string, unknown>) };
    const existing = profile.candidate_result as { pending?: boolean; score_pct?: number | null } | undefined;
    if (existing && existing.pending === false && typeof existing.score_pct === 'number') {
      return row;
    }
    profile.candidate_result = { pending: true, score_pct: null, outcome: null };
    row.projectProfile = profile;
    await this.submissions.save(row);
    return row;
  }

  async saveCandidateResult(
    interviewToken: string,
    result: { scorePct: number | null; outcome: 'advanced' | 'completed' | 'eliminated' },
  ) {
    const row = await this.findByAnySessionToken(interviewToken);
    if (!row) return;
    const fresh = await this.submissions.findOne({ where: { id: row.id, inactive: 0 } });
    if (!fresh) return;
    const profile = { ...((fresh.projectProfile ?? {}) as Record<string, unknown>) };
    profile.candidate_result = {
      pending: false,
      score_pct: result.scorePct,
      outcome: result.outcome,
    };
    fresh.projectProfile = profile;
    if (fresh.status !== ProjectInterviewStatus.COMPLETED) {
      fresh.status = ProjectInterviewStatus.COMPLETED;
    }
    await this.submissions.save(fresh);
  }

  async markCompletedByInterviewToken(interviewToken: string): Promise<void> {
    await this.submissions.update(
      { interviewToken, status: ProjectInterviewStatus.READY_FOR_INTERVIEW },
      { status: ProjectInterviewStatus.COMPLETED },
    );
  }

  /** Resolve submission from either Build or Defend LiveKit token. */
  async findByAnySessionToken(sessionToken: string) {
    const t = (sessionToken ?? '').trim();
    if (!t) return null;
    return (
      (await this.submissions.findOne({ where: { interviewToken: t, inactive: 0 } })) ??
      (await this.submissions.findOne({ where: { buildSessionToken: t, inactive: 0 } }))
    );
  }

  /** Payload for the Build intro-only voice agent. */
  async buildBuildPhasePayload(buildSessionToken: string): Promise<Record<string, unknown> | null> {
    const row = await this.submissions.findOne({
      where: { buildSessionToken, inactive: 0 },
    });
    if (!row) return null;
    const config = this.config(row);
    const choice = this.selectedChoice(row);
    return {
      submission_id: row.id,
      submission_token: row.submissionToken,
      bnd_phase: 'build',
      max_assessment_hours: config.max_assessment_hours,
      due_at: row.dueAt?.toISOString() ?? null,
      project: choice
        ? {
            id: choice.id,
            title: choice.title,
            description_md: choice.description_md.slice(0, 4000),
            twist_requirement: choice.twist_requirement || null,
            must_have_requirements: choice.must_have_requirements,
            tech_stack: choice.tech_stack,
            deliverables: choice.deliverables,
          }
        : null,
    };
  }

  /** `project_interview_payload` for the Defend voice engine. */
  async buildVoicePayload(interviewToken: string): Promise<Record<string, unknown> | null> {
    const row = await this.submissions.findOne({ where: { interviewToken, inactive: 0 } });
    if (!row) return null;
    const config = this.config(row);
    const choice = this.selectedChoice(row);
    const snapshot = (row.repoSnapshot ?? {}) as Record<string, unknown>;
    return {
      submission_id: row.id,
      bnd_phase: 'defend',
      repo_url: row.githubUrl,
      project: choice
        ? {
            id: choice.id,
            title: choice.title,
            submission_type: choice.submission_type,
            description_md: choice.description_md.slice(0, 4000),
            twist_requirement: choice.twist_requirement || null,
            must_have_requirements: choice.must_have_requirements,
            tech_stack: choice.tech_stack,
          }
        : null,
      project_profile: row.projectProfile ?? {},
      repo_signals: {
        readme_excerpt: typeof snapshot.readme === 'string' ? snapshot.readme.slice(0, 3000) : '',
        file_tree: Array.isArray(snapshot.file_tree) ? snapshot.file_tree.slice(0, 150) : [],
        manifests: snapshot.manifests ?? {},
      },
      ai_interviewer: config.ai_interviewer,
      // Voice engine scores defense at 100%; Nest reports re-weight vs code_submission.
      interview_weight_pct: 100,
      scoring_weights: config.scoring_weights,
      code_weight_pct: config.scoring_weights.code_submission,
      // Guideposts for conversational Defend; exact script only when fallback is DETERMINISTIC_STATIC.
      locked_defense_questions: row.lockedDefenseQuestions ?? null,
      interview_questions_locked: Boolean(row.interviewQuestionsLocked),
      evaluation_fallback_level: row.evaluationFallbackLevel ?? 'NONE',
    };
  }

  /**
   * Returns all active Project Interview submissions for a job application.
   */
  async getSubmissionsForApplication(
    applicationId: string,
  ): Promise<ProjectInterviewSubmissionMysql[]> {
    return this.submissions.find({
      where: { jobApplicationId: applicationId, inactive: 0 },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Batch live Build & Defend metadata (score + status) for reports.
   * Key: `${jobApplicationId}:${stageId}` → ProjectStageMeta.
   */
  async getProjectMetaByAppStage(
    applicationIds: string[],
  ): Promise<Map<string, ProjectStageMeta>> {
    const out = new Map<string, ProjectStageMeta>();
    const ids = [...new Set(applicationIds.map(String).filter(Boolean))];
    if (!ids.length) return out;

    const rows = await this.submissions.find({
      where: { jobApplicationId: In(ids), inactive: 0 },
    });
    if (!rows.length) return out;

    const tokens = [
      ...new Set(rows.map((r) => r.interviewToken).filter((t): t is string => Boolean(t))),
    ];
    const [interviews, rounds] = await Promise.all([
      tokens.length
        ? this.interviews.find({ where: { candidateToken: In(tokens) } })
        : Promise.resolve([] as CandidateAutonomousInterviewMysql[]),
      tokens.length
        ? this.interviewRounds.find({
            where: {
              candidateToken: In(tokens),
              roundType: AutonomousInterviewRoundType.BND_INTERVIEW,
            },
          })
        : Promise.resolve([] as AutonomousInterviewRoundMysql[]),
    ]);

    const interviewByToken = new Map(interviews.map((i) => [i.candidateToken, i]));
    const roundByToken = new Map<string, AutonomousInterviewRoundMysql>();
    const newestFirst = [...rounds].sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    );
    for (const round of newestFirst) {
      if (!roundByToken.has(round.candidateToken)) {
        roundByToken.set(round.candidateToken, round);
      }
    }

    for (const row of rows) {
      const scored = this.scoreReportParts(row, interviewByToken, roundByToken);
      const defend = row.interviewToken ? interviewByToken.get(row.interviewToken) : undefined;
      out.set(`${row.jobApplicationId}:${row.stageId}`, {
        scorePct: scored.finalCombinedScorePct ?? null,
        status: row.status,
        selectedProjectId: row.selectedProjectId,
        defendCompleted: defend?.currentPhase === AutonomousInterviewPhase.COMPLETED,
      });
    }
    return out;
  }

  /**
   * Batch final Build & Defend scores for the reports list.
   * Key: `${jobApplicationId}:${stageId}` → final_combined_score_pct.
   */
  async getFinalCombinedScoresByAppStage(
    applicationIds: string[],
  ): Promise<Map<string, number>> {
    const metaMap = await this.getProjectMetaByAppStage(applicationIds);
    const out = new Map<string, number>();
    for (const [key, meta] of metaMap.entries()) {
      if (meta.scorePct != null) {
        out.set(key, meta.scorePct);
      }
    }
    return out;
  }

  /** Recruiter-facing summary for reports (code + verbal joined via interview_token). */
  async getReportSummary(applicationId: string, stageId: string) {
    const row = await this.submissions.findOne({
      where: { jobApplicationId: applicationId, stageId, inactive: 0 },
    });
    if (!row) return null;

    const interviewByToken = new Map<string, CandidateAutonomousInterviewMysql>();
    const roundByToken = new Map<string, AutonomousInterviewRoundMysql>();
    if (row.interviewToken) {
      const [round, interview] = await Promise.all([
        this.interviewRounds.findOne({
          where: {
            candidateToken: row.interviewToken,
            roundType: AutonomousInterviewRoundType.BND_INTERVIEW,
          },
        }),
        this.interviews.findOne({
          where: { candidateToken: row.interviewToken },
        }),
      ]);
      if (interview) interviewByToken.set(row.interviewToken, interview);
      if (round) roundByToken.set(row.interviewToken, round);
    }

    const scored = this.scoreReportParts(row, interviewByToken, roundByToken);
    const choice = this.selectedChoice(row);
    const config = this.config(row);

    const round = row.interviewToken ? roundByToken.get(row.interviewToken) : null;
    const interview = row.interviewToken ? interviewByToken.get(row.interviewToken) : null;

    let buildDurationMinutes: number | null = null;
    const buildStart = row.selectedAt ?? row.selectionStartedAt ?? row.createdAt;
    if (row.submittedAt && buildStart) {
      const diffMs = row.submittedAt.getTime() - buildStart.getTime();
      if (diffMs > 0) {
        buildDurationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    }

    let defendDurationMinutes: number | null = null;
    if (round?.createdAt && round?.updatedAt) {
      const diffMs = round.updatedAt.getTime() - round.createdAt.getTime();
      if (diffMs > 0) {
        defendDurationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    } else if (interview?.createdAt && interview?.updatedAt) {
      const diffMs = interview.updatedAt.getTime() - interview.createdAt.getTime();
      if (diffMs > 0) {
        defendDurationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    }

    const durationMinutes =
      buildDurationMinutes != null || defendDurationMinutes != null
        ? (buildDurationMinutes ?? 0) + (defendDurationMinutes ?? 0)
        : null;

    const submissionType = choice?.submission_type ?? 'github_url';
    const fileFormat = (row.submissionFileFormat ?? '').toLowerCase() || null;
    let submissionFileUrl: string | null = null;
    let submissionFileName: string | null = null;
    if (row.submissionZipUrl) {
      const ext =
        fileFormat === 'pdf'
          ? 'pdf'
          : fileFormat === 'zip'
            ? 'zip'
            : fileFormat === 'xlsx' || fileFormat === 'xls'
              ? fileFormat
              : row.submissionZipUrl.toLowerCase().includes('.pdf')
                ? 'pdf'
                : row.submissionZipUrl.toLowerCase().includes('.zip')
                  ? 'zip'
                  : 'xlsx';
      const safeTitle =
        (choice?.title ?? 'submission').replace(/[^\w.\- ]+/g, '').trim().slice(0, 60) ||
        'submission';
      submissionFileName = `${safeTitle}.${ext}`;
      submissionFileUrl = await this.signDownload(row.submissionZipUrl);
    }

    return {
      submission_id: row.id,
      status: row.status,
      project_id: row.selectedProjectId,
      project_title: choice?.title ?? null,
      submission_type: submissionType,
      github_url: row.githubUrl,
      github_branch: row.githubBranch,
      submission_file_url: submissionFileUrl,
      submission_file_name: submissionFileName,
      submission_file_format: fileFormat,
      submitted_at: row.submittedAt?.toISOString() ?? null,
      evaluated_at: row.evaluatedAt?.toISOString() ?? null,
      duration_minutes: durationMinutes,
      build_duration_minutes: buildDurationMinutes,
      defend_duration_minutes: defendDurationMinutes,
      interview_token: row.interviewToken,
      build_session_token: row.buildSessionToken,
      project_profile: row.projectProfile,
      scoring_weights: config.scoring_weights,
      code_build_score_pct: scored.codeBuildScorePct,
      verbal_defend_score_pct: scored.verbalDefendScorePct,
      final_combined_score_pct: scored.finalCombinedScorePct,
    };
  }

  private scoreReportParts(
    row: ProjectInterviewSubmissionMysql,
    interviewByToken: Map<string, CandidateAutonomousInterviewMysql>,
    roundByToken: Map<string, AutonomousInterviewRoundMysql>,
  ): {
    codeBuildScorePct: number | null;
    verbalDefendScorePct: number | null;
    finalCombinedScorePct: number | null;
  } {
    const config = this.config(row);
    const profile = (row.projectProfile ?? {}) as Record<string, unknown>;
    const scores =
      profile.evaluation_scores && typeof profile.evaluation_scores === 'object'
        ? (profile.evaluation_scores as Record<string, unknown>)
        : {};
    const rawCodeBuildScorePct =
      typeof scores.requirements_score_pct === 'number' &&
      Number.isFinite(scores.requirements_score_pct)
        ? Math.round(scores.requirements_score_pct)
        : null;
    // Without sandbox execution, cap 99-100 scores at 94
    const codeBuildScorePct =
      rawCodeBuildScorePct != null && rawCodeBuildScorePct >= 95 ? 94 : rawCodeBuildScorePct;

    let verbalDefendScorePct: number | null = null;
    if (row.interviewToken) {
      const interview = interviewByToken.get(row.interviewToken);
      if (interview) {
        const round = roundByToken.get(row.interviewToken);
        const auditForScore =
          (round?.chatTranscript as object | null) ?? interview.stage1VoiceAudit ?? null;
        verbalDefendScorePct = this.verbalDefendScorePct({
          ...interview,
          stage1VoiceAudit: auditForScore,
        });
      }
    }

    const earlyEnd = Boolean(
      (row.projectProfile as Record<string, unknown> | null)?.early_end_without_submission,
    );
    const codeW = config.scoring_weights.code_submission;
    const interviewW = config.scoring_weights.interview_performance;
    let finalCombinedScorePct: number | null = null;
    if (earlyEnd || row.status === ProjectInterviewStatus.COMPLETED) {
      const code = earlyEnd ? 0 : (codeBuildScorePct ?? 0);
      const verbal = earlyEnd ? 0 : (verbalDefendScorePct ?? 0);
      finalCombinedScorePct = Math.round((code * codeW + verbal * interviewW) / 100);
    } else if (codeBuildScorePct != null || verbalDefendScorePct != null) {
      const code = codeBuildScorePct ?? 0;
      const verbal = verbalDefendScorePct ?? 0;
      if (codeBuildScorePct != null && verbalDefendScorePct != null) {
        finalCombinedScorePct = Math.round((code * codeW + verbal * interviewW) / 100);
      } else if (codeBuildScorePct != null) {
        finalCombinedScorePct = codeBuildScorePct;
      } else {
        finalCombinedScorePct = verbalDefendScorePct;
      }
    }

    if (finalCombinedScorePct != null && finalCombinedScorePct >= 95) {
      finalCombinedScorePct = 94;
    }

    return { codeBuildScorePct, verbalDefendScorePct, finalCombinedScorePct };
  }

  /** Prefer defense audit / voice score from the interview_token session. */
  private verbalDefendScorePct(interview: CandidateAutonomousInterviewMysql): number | null {
    const audit = interview.stage1VoiceAudit as Record<string, unknown> | undefined;
    if (audit && typeof audit === 'object') {
      const projectBlock = audit.project_interview as Record<string, unknown> | undefined;
      const defense = Number(projectBlock?.defense_score_pct);
      if (Number.isFinite(defense)) return Math.round(defense);
      const combined = Number(audit.final_combined_score_pct);
      if (Number.isFinite(combined)) return Math.round(combined);
      const th = audit.take_home_verification as Record<string, unknown> | undefined;
      const thPct = Number(th?.take_home_verification_score_pct);
      if (Number.isFinite(thPct)) return Math.round(thPct);
      const overall10 = Number(audit.weighted_overall_10);
      if (Number.isFinite(overall10)) return Math.round(overall10 * 10);
    }
    const voice = Number(interview.stage1VoiceScore);
    if (Number.isFinite(voice) && voice > 0) return Math.round(voice * 10);
    return null;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  private config(row: ProjectInterviewSubmissionMysql): ProjectInterviewRoundConfig {
    return normalizeProjectInterviewRoundConfig(row.configSnapshot);
  }

  private selectedChoice(row: ProjectInterviewSubmissionMysql): ProjectChoice | null {
    if (!row.selectedProjectId) return null;
    return this.config(row).project_choices.find((c) => c.id === row.selectedProjectId) ?? null;
  }

  async downloadProjectFiles(token: string, projectId: string): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
  }> {
    const row = await this.requireByToken(token);
    const choice = this.config(row).project_choices.find((item) => item.id === projectId);
    if (!choice) throw new NotFoundException('Project not found');

    const listed = [
      ...(choice.assessment_document?.file_url ? [choice.assessment_document] : []),
      ...(choice.supporting_datasets ?? []).filter((file) => file.file_url),
    ];
    if (!listed.length) throw new NotFoundException('No assessment files to download');

    const used = new Set<string>();
    const packed: Array<{ name: string; data: Buffer }> = [];
    for (const file of listed) {
      let got: { buffer: Buffer; contentType: string } | null = null;
      try {
        got = await downloadObjectBytes({ storagePath: file.file_url });
      } catch (err) {
        this.logger.warn(
          `Assessment file download failed name=${file.filename}: ${err instanceof Error ? err.message : err}`,
        );
      }
      if (!got?.buffer.length) {
        throw new NotFoundException(`Could not download ${file.filename}`);
      }
      let name = file.filename.split(/[/\\]/).pop()?.replace(/[^\w.\- ()]+/g, '_').slice(0, 180) || 'file';
      if (used.has(name.toLowerCase())) name = `${packed.length + 1}-${name}`;
      used.add(name.toLowerCase());
      packed.push({ name, data: got.buffer });
    }

    if (packed.length === 1) {
      const name = ensureDownloadExtension(packed[0]!.name, choice.submission_type);
      return {
        buffer: packed[0]!.data,
        filename: name,
        contentType: contentTypeForFilename(name),
      };
    }
    const title = choice.title.replace(/[^\w.\- ]+/g, '').trim().slice(0, 60) || 'assessment';
    return {
      buffer: buildDownloadZip(packed),
      filename: `${title}-files.zip`,
      contentType: 'application/zip',
    };
  }

  private async signDownload(fileUrl: string): Promise<string> {
    try {
      return await resolveLocalDownloadUrl({
        storagePath: fileUrl,
      });
    } catch (err) {
      this.logger.warn(`Could not resolve download URL: ${err instanceof Error ? err.message : err}`);
      return fileUrl;
    }
  }

  private async signChoiceDownloads<
    T extends {
      assessment_document?: { filename: string; file_url: string } | null;
      supporting_datasets?: Array<{ filename: string; file_url: string }>;
    },
  >(choice: T): Promise<T> {
    const assessment = choice.assessment_document
      ? {
          ...choice.assessment_document,
          file_url: await this.signDownload(choice.assessment_document.file_url),
        }
      : choice.assessment_document ?? null;
    const datasets = await Promise.all(
      (choice.supporting_datasets ?? []).map(async (file) => ({
        ...file,
        file_url: await this.signDownload(file.file_url),
      })),
    );
    return { ...choice, assessment_document: assessment, supporting_datasets: datasets };
  }

  private async serializeForCandidate(row: ProjectInterviewSubmissionMysql) {
    const config = this.config(row);
    const stage = await this.stages.findOne({ where: { id: row.stageId } });
    const app = await this.applications.findOne({ where: { id: row.jobApplicationId } });
    const jobProfile = app
      ? await this.profiles.findOne({ where: { id: app.jobProfileId } })
      : null;
    const selected = this.selectedChoice(row);
    const projects = await Promise.all(
      config.project_choices.map((choice) => this.signChoiceDownloads(sanitizeProjectChoiceForCandidate(choice))),
    );
    const selectedView = selected
      ? await this.signChoiceDownloads(sanitizeProjectChoiceForCandidate(selected))
      : null;
    return {
      submission_token: row.submissionToken,
      portal_token: row.portalToken,
      status: row.status,
      stage_name: stage?.name ?? 'Build & Defend',
      job_title: jobProfile?.title ?? null,
      max_assessment_hours: config.max_assessment_hours,
      selection_started_at: row.selectionStartedAt?.toISOString() ?? null,
      selection_countdown_seconds: PROJECT_INTERVIEW_SELECTION_COUNTDOWN_SECONDS,
      projects,
      selected_project_id: row.selectedProjectId,
      selected_project: selectedView,
      selected_at: row.selectedAt?.toISOString() ?? null,
      due_at: row.dueAt?.toISOString() ?? null,
      github_url: row.githubUrl,
      github_branch: row.githubBranch,
      submitted_at: row.submittedAt?.toISOString() ?? null,
      last_error: row.lastError,
      interview: {
        question_count: config.ai_interviewer.question_count,
        duration_minutes: config.ai_interviewer.duration_minutes,
      },
      build_session_token: row.buildSessionToken,
      interview_token:
        row.status === ProjectInterviewStatus.READY_FOR_INTERVIEW ? row.interviewToken : null,
      result: this.candidateResult(row),
    };
  }

  private candidateResult(row: ProjectInterviewSubmissionMysql) {
    const raw = (row.projectProfile as Record<string, unknown> | null)?.candidate_result;
    if (!raw || typeof raw !== 'object') return null;
    const result = raw as { pending?: unknown; score_pct?: unknown; outcome?: unknown };
    const outcome =
      result.outcome === 'advanced' || result.outcome === 'completed' || result.outcome === 'eliminated'
        ? result.outcome
        : null;
    return {
      pending: Boolean(result.pending),
      score_pct: typeof result.score_pct === 'number' ? result.score_pct : null,
      outcome,
    };
  }
}
