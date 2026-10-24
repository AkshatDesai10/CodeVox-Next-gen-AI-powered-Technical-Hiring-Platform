import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

/**
 * PENDING_SUBMISSION → IN_BUILD → EVALUATING_CODE → READY_FOR_INTERVIEW → COMPLETED.
 * A failed repo fetch drops back to IN_BUILD with `lastError` so the candidate can resubmit.
 */
export enum ProjectInterviewStatus {
  PENDING_SUBMISSION = 'pending_submission',
  IN_BUILD = 'in_build',
  EVALUATING_CODE = 'evaluating_code',
  READY_FOR_INTERVIEW = 'ready_for_interview',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

@Entity('project_interview_submissions')
export class ProjectInterviewSubmissionMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_application_id' })
  jobApplicationId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'stage_id' })
  stageId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'varchar', length: 128, name: 'portal_token' })
  portalToken: string;

  @Column({ type: 'varchar', length: 64, name: 'submission_token', unique: true })
  submissionToken: string;

  @Column({
    type: 'enum',
    enum: ProjectInterviewStatus,
    default: ProjectInterviewStatus.PENDING_SUBMISSION,
  })
  status: ProjectInterviewStatus;

  @Column({ type: 'varchar', length: 64, name: 'selected_project_id', nullable: true })
  selectedProjectId: string | null;

  @Column({ type: 'timestamp', precision: 6, name: 'selected_at', nullable: true })
  selectedAt: Date | null;

  /** When the candidate first opened the project-selection page (powers the 10m countdown). */
  @Column({ type: 'timestamp', precision: 6, name: 'selection_started_at', nullable: true })
  selectionStartedAt: Date | null;

  @Column({ type: 'timestamp', precision: 6, name: 'due_at', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'varchar', length: 512, name: 'github_url', nullable: true })
  githubUrl: string | null;

  @Column({ type: 'varchar', length: 128, name: 'github_branch', nullable: true })
  githubBranch: string | null;

  /** Private S3 URL of a document-pack zip or Excel/PDF practical file. Null for GitHub submissions. */
  @Column({ type: 'varchar', length: 1024, name: 'submission_zip_url', nullable: true })
  submissionZipUrl: string | null;

  /** github | zip | xlsx | pdf — set on submit for practical / pack flows. */
  @Column({ type: 'varchar', length: 16, name: 'submission_file_format', nullable: true })
  submissionFileFormat: string | null;

  @Column({ type: 'timestamp', precision: 6, name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamp', precision: 6, name: 'evaluated_at', nullable: true })
  evaluatedAt: Date | null;

  @Column({ type: 'json', name: 'config_snapshot', nullable: true })
  configSnapshot: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'repo_snapshot', nullable: true })
  repoSnapshot: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'project_profile', nullable: true })
  projectProfile: Record<string, unknown> | null;

  /** Once true, locked_defense_questions must not change (background code re-score is score-only). */
  @Column({ type: 'tinyint', unsigned: true, name: 'interview_questions_locked', default: 0 })
  interviewQuestionsLocked: number;

  @Column({ type: 'json', name: 'locked_defense_questions', nullable: true })
  lockedDefenseQuestions: Array<{ question: string; topic?: string; expected_answer?: string }> | null;

  /** NONE | LLM_METADATA | DETERMINISTIC_STATIC | AST_PRIMARY | EXCEL_KEY | PDF_SOFT */
  @Column({ type: 'varchar', length: 32, name: 'evaluation_fallback_level', default: 'NONE' })
  evaluationFallbackLevel: string;

  /** ExcelJS grade details (score, mistakes, hardcoded cells) for reports + Defend Q synth. */
  @Column({ type: 'json', name: 'excel_evaluation_summary', nullable: true })
  excelEvaluationSummary: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  /** `ses_` token of the Defend (project interview) LiveKit session. */
  @Column({ type: 'varchar', length: 128, name: 'interview_token', nullable: true })
  interviewToken: string | null;

  /** `ses_` token of the Build/assessment LiveKit session. */
  @Column({ type: 'varchar', length: 128, name: 'build_session_token', nullable: true })
  buildSessionToken: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 6, name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 6, name: 'updated_at' })
  updatedAt: Date;
}
