import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum TakeHomeEvalRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class TakeHomeEvalRunMysql {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'submission_id', type: 'varchar', length: 36 })
  submissionId: string;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status: TakeHomeEvalRunStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  score: string | null;

  @Column({ name: 'result_json', type: 'json', nullable: true })
  resultJson: any;

  @Column({ name: 'harness_log', type: 'text', nullable: true })
  harnessLog: string | null;

  @Column({ name: 'harness_output_json', type: 'json', nullable: true })
  harnessOutputJson: any;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'tinyint', default: 0 })
  inactive: number;
}
