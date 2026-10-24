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

export enum CompetencyCategory {
  HARD = 'hard',
  SOFT = 'soft',
}

@Entity('job_profile_competencies')
export class JobProfileCompetencyMysql extends ActiveMysqlRow {
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

  @Column({ name: 'stage_id', type: 'varchar', length: 36, nullable: true })
  stageId: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: CompetencyCategory, default: CompetencyCategory.HARD })
  category: CompetencyCategory;

  @Column({ type: 'decimal', precision: 4, scale: 1, name: 'target_score', nullable: true })
  targetScore: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'weight_pct', default: 0 })
  weightPct: string;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  /** Per-rubric AI Verbal question categories and maximum. Null keeps seniority defaults. */
  @Column({ type: 'json', name: 'question_plan', nullable: true })
  questionPlan: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => JobProfileMysql, (p) => p.competencies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_profile_id' })
  profile: JobProfileMysql;
}
