import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('recruitment_lead_overlay')
@Unique('uq_recruitment_lead_overlay_lead_id', ['leadId'])
export class RecruitmentLeadOverlayMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'lead_id' })
  leadId: string;

  @Column({ type: 'varchar', length: 64, name: 'portal_stage', nullable: true })
  portalStage: string | null;

  @Column({ type: 'varchar', length: 64, name: 'counselor_override_id', nullable: true })
  counselorOverrideId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'ai_score', nullable: true })
  aiScore: string | null;

  @Column({ type: 'json', name: 'ai_qualification_json', nullable: true })
  aiQualificationJson: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'parsed_resume_json', nullable: true })
  parsedResumeJson: Record<string, unknown> | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'resume_mismatch_flag', default: 0 })
  resumeMismatchFlag: number;

  @Column({ type: 'timestamp', name: 'last_local_action_at', nullable: true })
  lastLocalActionAt: Date | null;

  @Column({ type: 'varchar', length: 32, name: 'invite_status', nullable: true })
  inviteStatus: string | null;

  @Column({ type: 'varchar', length: 64, name: 'invite_token', nullable: true })
  inviteToken: string | null;

  @Column({ type: 'varchar', length: 32, name: 'resume_match_status', nullable: true })
  resumeMatchStatus: string | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'resume_match_score',
    nullable: true,
  })
  resumeMatchScore: string | null;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 3,
    name: 'resume_match_confidence',
    nullable: true,
  })
  resumeMatchConfidence: string | null;

  @Column({ type: 'json', name: 'resume_match_json', nullable: true })
  resumeMatchJson: Record<string, unknown> | null;

  @Column({
    type: 'bigint',
    unsigned: true,
    name: 'resume_match_job_profile_id',
    nullable: true,
  })
  resumeMatchJobProfileId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'resume_match_job_fingerprint', nullable: true })
  resumeMatchJobFingerprint: string | null;

  @Column({ type: 'varchar', length: 64, name: 'resume_match_cv_hash', nullable: true })
  resumeMatchCvHash: string | null;

  @Column({ type: 'varchar', length: 32, name: 'resume_match_analyzer_version', nullable: true })
  resumeMatchAnalyzerVersion: string | null;

  @Column({ type: 'timestamp', name: 'resume_match_analyzed_at', nullable: true })
  resumeMatchAnalyzedAt: Date | null;

  @Column({ type: 'varchar', length: 500, name: 'resume_match_error', nullable: true })
  resumeMatchError: string | null;

  @Column({ type: 'mediumtext', name: 'resume_extracted_text', nullable: true })
  resumeExtractedText: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
