import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { QuestionBankDifficulty } from './question-bank-question.mysql.entity';

export enum ProblemBankStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
  RETIRED = 'retired',
}

@Entity('problem_bank_problems')
export class ProblemBankProblemMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'longtext', name: 'statement_md' })
  statementMd: string;

  @Column({ type: 'enum', enum: QuestionBankDifficulty, default: QuestionBankDifficulty.MEDIUM })
  difficulty: QuestionBankDifficulty;

  @Column({ type: 'int', unsigned: true, default: 0 })
  marks: number;

  @Column({ type: 'enum', enum: ProblemBankStatus, default: ProblemBankStatus.DRAFT })
  status: ProblemBankStatus;

  @Column({ type: 'json', name: 'topic_tags', nullable: true })
  topicTags: string[] | null;

  @Column({ type: 'json', name: 'allowed_languages', nullable: true })
  allowedLanguages: string[] | null;

  @Column({ type: 'int', unsigned: true, name: 'time_limit_minutes', nullable: true })
  timeLimitMinutes: number | null;

  @Column({ type: 'varchar', length: 64, name: 'workspace_type', nullable: true })
  workspaceType: string | null;

  @Column({
    type: 'enum',
    enum: ['TESTCASE', 'AI', 'HYBRID'],
    name: 'evaluation_mode',
    nullable: true,
  })
  evaluationMode: string | null;

  @Column({ type: 'json', name: 'environment_config', nullable: true })
  environmentConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'evaluation_config', nullable: true })
  evaluationConfig: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  hints: string[] | null;

  @Column({ type: 'json', name: 'plagiarism_baseline_json', nullable: true })
  plagiarismBaselineJson: Record<string, unknown> | null;

  @Column({ type: 'int', unsigned: true, name: 'usage_count', default: 0 })
  usageCount: number;

  @Column({ type: 'int', unsigned: true, name: 'sessions_count', default: 0 })
  sessionsCount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'pass_rate_visible', nullable: true })
  passRateVisible: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'pass_rate_hidden', nullable: true })
  passRateHidden: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'avg_first_submission_seconds', nullable: true })
  avgFirstSubmissionSeconds: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'avg_final_score', nullable: true })
  avgFinalScore: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'leak_risk_flag', default: 0 })
  leakRiskFlag: number;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'updated_by_user_id', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
