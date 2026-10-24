import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  BeforeInsert,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { JobProfileMysql } from './job-profile.mysql.entity';

export enum JobQuestionKind {
  ANCHOR = 'anchor',
  MANUAL = 'manual',
  AI_ADAPTIVE = 'ai_adaptive',
}

@Entity('job_profile_questions')
export class JobProfileQuestionMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'bigint', unsigned: true })
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id || String(this.id) === '0') {
      // Generate a unique BigInt ID (timestamp + random 4 digits)
      const ts = Date.now().toString();
      const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      this.id = ts + rand;
    }
  }

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'stage_id', nullable: true })
  stageId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'question_bank_id', nullable: true })
  questionBankId: string | null;

  @Column({ type: 'int', unsigned: true, name: 'question_bank_version', nullable: true })
  questionBankVersion: number | null;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_bank_id', nullable: true })
  problemBankId: string | null;

  @Column({ type: 'int', unsigned: true, name: 'problem_bank_version', nullable: true })
  problemBankVersion: number | null;

  @Column({ type: 'enum', enum: JobQuestionKind, default: JobQuestionKind.MANUAL })
  kind: JobQuestionKind;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'required_flag', default: 1 })
  requiredFlag: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'weight_pct', nullable: true })
  weightPct: string | null;

  @Column({ type: 'json', name: 'mapped_competency_ids', nullable: true })
  mappedCompetencyIds: string[] | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => JobProfileMysql, (p) => p.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_profile_id' })
  profile: JobProfileMysql;
}
