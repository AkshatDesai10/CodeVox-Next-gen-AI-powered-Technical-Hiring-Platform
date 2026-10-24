import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum TakeHomeSubmissionStatus {
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  GRADING = 'grading',
  GRADED = 'graded',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

export class TakeHomeSubmissionMysql {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'stage_id', type: 'varchar', length: 36, nullable: true })
  stageId: string | null;

  @Column({ name: 'job_application_id', type: 'varchar', length: 36, nullable: true })
  jobApplicationId: string | null;

  @Column({ name: 'candidate_id', type: 'varchar', length: 36, nullable: true })
  candidateId: string | null;

  @Column({ name: 'submission_token', type: 'varchar', length: 64, nullable: true })
  submissionToken: string;

  @Column({ type: 'varchar', length: 32, default: 'assigned' })
  status: TakeHomeSubmissionStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'json', nullable: true })
  scoresJson: any;

  @Column({ type: 'json', nullable: true })
  criteriaResultsJson: any;

  @Column({ name: 'artifact_type', type: 'varchar', length: 32, default: 'github' })
  artifactType: string;

  @Column({ name: 'artifact_uri', type: 'text', nullable: true })
  artifactUri: string | null;

  @Column({ name: 'github_url', type: 'text', nullable: true })
  githubUrl: string | null;

  @Column({ name: 'github_branch', type: 'varchar', length: 128, default: 'main' })
  githubBranch: string;

  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'due_at', type: 'datetime', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'config_snapshot', type: 'json', nullable: true })
  configSnapshot: any;

  @Column({ name: 'plagiarism_score', type: 'decimal', precision: 5, scale: 2, nullable: true })
  plagiarismScore: number | null;

  @Column({ name: 'ai_probability', type: 'decimal', precision: 5, scale: 2, nullable: true })
  aiProbability: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'tinyint', default: 0 })
  inactive: number;
}
