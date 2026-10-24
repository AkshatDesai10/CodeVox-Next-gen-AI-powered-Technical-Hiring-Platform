import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  BeforeInsert,
  UpdateDateColumn,
} from 'typeorm';

export class ColumnNumericTransformer {
  to(data: number | null): number | null {
    return data;
  }
  from(data: string | number | null): number | null {
    if (data == null) return null;
    const res = typeof data === 'string' ? parseFloat(data) : data;
    return isNaN(res) ? null : res;
  }
}

export type TestCaseResult = {
  id: string;
  name: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  time_ms: number;
  is_visible: boolean;
};

@Entity('coding_round_submissions')
export class CodingRoundSubmissionEntity {
  @PrimaryColumn({ type: 'bigint', unsigned: true })
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id || String(this.id) === '0') {
      const ts = Date.now().toString();
      const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      this.id = ts + rand;
    }
  }

  @Column({ type: 'bigint', unsigned: true, name: 'application_id' })
  applicationId: string;

  @Column({ type: 'varchar', length: 64, name: 'stage_key' })
  stageKey: string;

  @Column({ type: 'enum', enum: ['in_progress', 'grading', 'submitted', 'error'], default: 'in_progress' })
  status: 'in_progress' | 'grading' | 'submitted' | 'error';

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'score_pct', transformer: new ColumnNumericTransformer() })
  scorePct: number | null;

  @Column({ type: 'json', name: 'problem_submissions', nullable: true })
  problemSubmissions: Record<string, {
    language: string;
    sourceCode: string;
    testResults: TestCaseResult[] | null;
    scorePct: number | null;
  }> | null;

  /** Per-candidate Problem Bank assignment when question_strategy is bank_only. */
  @Column({ type: 'json', name: 'assigned_problem_ids', nullable: true })
  assignedProblemIds: string[] | null;

  @Column({ type: 'timestamp', nullable: true, name: 'submitted_at' })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Soft-delete flag. Active attempt = 0 (false).
   * DB unique is on generated `active_uniq_key` (NULL when inactive=1).
   */
  @Column({ type: 'tinyint', width: 1, default: 0 })
  inactive: boolean;

  /**
   * Generated unique key to enforce one active submission per app_id + stage_key.
   */
  @Column({ type: 'varchar', length: 191, name: 'active_uniq_key', select: false, insert: false, update: false, nullable: true })
  activeUniqKey?: string;
}
