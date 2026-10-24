import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  BeforeInsert,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { JobProfileStageMysql } from './job-profile-stage.mysql.entity';
import { JobProfileCompetencyMysql } from './job-profile-competency.mysql.entity';
import { JobProfileQuestionMysql } from './job-profile-question.mysql.entity';

export enum JobProfileStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  ACTIVE = 'active',
  PAUSED = 'paused',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

export enum JobLocationMode {
  REMOTE = 'remote',
  HYBRID = 'hybrid',
  ONSITE = 'onsite',
}

@Entity('job_profiles')
export class JobProfileMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'bigint', unsigned: true })
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id || this.id === '0') {
      // Generate a unique BigInt ID (timestamp + random 4 digits)
      const ts = Date.now().toString();
      const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      this.id = ts + rand;
    }
  }

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 64, name: 'seniority_level', nullable: true })
  seniorityLevel: string | null;

  @Column({ type: 'varchar', length: 64, name: 'employment_type', nullable: true })
  employmentType: string | null;

  @Column({ type: 'int', unsigned: true, name: 'openings_count', default: 1 })
  openingsCount: number;

  @Column({ type: 'json', nullable: true })
  responsibilities: string[] | null;

  @Column({ type: 'json', name: 'required_skills', nullable: true })
  requiredSkills: string[] | null;

  @Column({ type: 'json', name: 'nice_to_have_skills', nullable: true })
  niceToHaveSkills: string[] | null;

  @Column({ type: 'decimal', precision: 4, scale: 1, name: 'experience_min', nullable: true })
  experienceMin: string | null;

  @Column({ type: 'decimal', precision: 4, scale: 1, name: 'experience_max', nullable: true })
  experienceMax: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'compensation_band_min', nullable: true })
  compensationBandMin: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'compensation_band_max', nullable: true })
  compensationBandMax: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true, default: 'INR' })
  currency: string | null;

  @Column({
    type: 'enum',
    enum: JobLocationMode,
    name: 'location_mode',
    nullable: true,
    default: JobLocationMode.HYBRID,
  })
  locationMode: JobLocationMode | null;

  @Column({ type: 'varchar', length: 200, name: 'location_text', nullable: true })
  locationText: string | null;

  @Column({ type: 'varchar', length: 64, name: 'language_required', nullable: true })
  languageRequired: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'owner_user_id', nullable: true })
  ownerUserId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'hiring_manager_user_id', nullable: true })
  hiringManagerUserId: string | null;

  @Column({ type: 'enum', enum: JobProfileStatus, default: JobProfileStatus.DRAFT })
  status: JobProfileStatus;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_template_id', nullable: true })
  assessmentTemplateId: string | null;

  @Column({ type: 'json', name: 'autonomous_interview_config', nullable: true })
  autonomousInterviewConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'proctor_config_override', nullable: true })
  proctorConfigOverride: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'candidate_facing_intro', nullable: true })
  candidateFacingIntro: string | null;

  @Column({ type: 'json', nullable: true })
  branding: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'compliance_config', nullable: true })
  complianceConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'threshold_config', nullable: true })
  thresholdConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'progression_config', nullable: true })
  progressionConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'notification_config', nullable: true })
  notificationConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'field_permissions', nullable: true })
  fieldPermissions: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'candidate_faq', nullable: true })
  candidateFaq: Array<{ question: string; answer: string }> | null;

  @Column({ type: 'json', name: 'ai_metadata', nullable: true })
  aiMetadata: Record<string, unknown> | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version: number;

  @Column({ type: 'timestamp', name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => JobProfileStageMysql, (s) => s.profile)
  stages: JobProfileStageMysql[];

  @OneToMany(() => JobProfileCompetencyMysql, (c) => c.profile)
  competencies: JobProfileCompetencyMysql[];

  @OneToMany(() => JobProfileQuestionMysql, (q) => q.profile)
  questions: JobProfileQuestionMysql[];
}
