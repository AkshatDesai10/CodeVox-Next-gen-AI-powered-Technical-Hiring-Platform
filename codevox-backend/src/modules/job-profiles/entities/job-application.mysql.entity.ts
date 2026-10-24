import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { JobProfileMysql } from './job-profile.mysql.entity';

export enum JobApplicationStatus {
  APPLIED = 'applied',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  HIRED = 'hired',
}

@Entity('job_applications')
export class JobApplicationMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'enum', enum: JobApplicationStatus, default: JobApplicationStatus.APPLIED })
  status: JobApplicationStatus;

  @Column({ type: 'bigint', unsigned: true, name: 'current_stage_id', nullable: true })
  currentStageId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'candidate_token', nullable: true })
  candidateToken: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'scored_version_id', nullable: true })
  scoredVersionId: string | null;

  @Column({ type: 'timestamp', name: 'stage_entered_at', nullable: true })
  stageEnteredAt: Date | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'pending_human_review', default: 0 })
  pendingHumanReview: number;

  @Column({ type: 'varchar', length: 32, name: 'auto_action', nullable: true })
  autoAction: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null;

  /** Candidate agreed to face capture / assessment terms on the portal dashboard. */
  @Column({ type: 'timestamp', name: 'face_consent_recorded_at', nullable: true, precision: 3 })
  faceConsentRecordedAt: Date | null;

  /** Face selfie captured and stored. Rounds stay locked until set. */
  @Column({ type: 'timestamp', name: 'face_captured_at', nullable: true, precision: 3 })
  faceCapturedAt: Date | null;

  @Column({ type: 'varchar', length: 512, name: 'face_photo_storage_key', nullable: true })
  facePhotoStorageKey: string | null;

  @Column({ type: 'varchar', length: 1024, name: 'face_photo_url', nullable: true })
  facePhotoUrl: string | null;

  /** Optional 128-d descriptor for later proctor match (JSON number[]). */
  @Column({ type: 'json', name: 'reference_face_descriptor', nullable: true })
  referenceFaceDescriptor: number[] | null;

  /** Dashboard choice for the voice interview: en (default) or hi. */
  @Column({ type: 'varchar', length: 8, name: 'interview_language', default: 'en' })
  interviewLanguage: string;

  /**
   * Cross-round hire evaluation (why hire / why not / recommendation + evidence).
   * Written after all rounds complete; null until generated.
   */
  @Column({ type: 'json', name: 'overall_evaluation', nullable: true })
  overallEvaluation: Record<string, unknown> | null;

  /** Mandatory guidelines accepted once on the candidate dashboard. */
  @Column({ type: 'timestamp', name: 'guidelines_accepted_at', nullable: true, precision: 3 })
  guidelinesAcceptedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'applied_at' })
  appliedAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => JobProfileMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_profile_id' })
  profile: JobProfileMysql;
}
