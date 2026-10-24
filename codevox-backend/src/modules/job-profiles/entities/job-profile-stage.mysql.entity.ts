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

export enum JobStageMode {
  AI_LED = 'ai_led',
  HUMAN_LED = 'human_led',
}

export enum JobStageType {
  SCREENING = 'screening',
  CODING = 'coding',
  AI_VERBAL = 'ai_verbal',
  HR_VERBAL = 'hr_verbal',
  PANEL = 'panel',
  CUSTOM = 'custom',
  TAKE_HOME = 'take_home',
  /** Autonomous HR pre-screen: topics + optional requirements, soft flags only (no rubrics/score). */
  AI_SCREENING = 'ai_screening',
  /** "Build & Defend": candidate builds a take-home project, then defends it in an AI voice interview. */
  PROJECT_INTERVIEW = 'project_interview',
}

@Entity('job_profile_stages')
export class JobProfileStageMysql extends ActiveMysqlRow {
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

  @Column({ type: 'varchar', length: 64, name: 'stage_key' })
  stageKey: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'enum', enum: JobStageMode, default: JobStageMode.AI_LED })
  mode: JobStageMode;

  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  mandatory: number;

  @Column({ type: 'enum', enum: JobStageType, name: 'stage_type', default: JobStageType.CUSTOM })
  stageType: JobStageType;

  @Column({ type: 'json', name: 'skip_rules', nullable: true })
  skipRules: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'round_config', nullable: true })
  roundConfig: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => JobProfileMysql, (p) => p.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_profile_id' })
  profile: JobProfileMysql;
}
