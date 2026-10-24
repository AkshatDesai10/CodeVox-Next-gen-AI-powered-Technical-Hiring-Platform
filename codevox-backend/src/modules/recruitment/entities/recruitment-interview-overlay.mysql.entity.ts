import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('recruitment_interview_overlay')
export class RecruitmentInterviewOverlayMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'interview_ref_id', nullable: true })
  interviewRefId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'lead_id' })
  leadId: string;

  @Column({ type: 'varchar', length: 64, name: 'portal_status', nullable: true })
  portalStatus: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  result: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @Column({ type: 'text', name: 'no_show_reason', nullable: true })
  noShowReason: string | null;

  @Column({ type: 'text', name: 'reschedule_reason', nullable: true })
  rescheduleReason: string | null;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'varchar', length: 64, name: 'status_override', nullable: true })
  statusOverride: string | null;

  @Column({ type: 'varchar', length: 64, name: 'entered_by', nullable: true })
  enteredBy: string | null;

  @Column({ type: 'timestamp', name: 'entered_at', nullable: true })
  enteredAt: Date | null;

  @Column({ type: 'json', name: 'ai_draft_result_json', nullable: true })
  aiDraftResultJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32, name: 'ai_recommendation', nullable: true })
  aiRecommendation: string | null;

  @Column({ type: 'varchar', length: 255, name: 'human_override_result', nullable: true })
  humanOverrideResult: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'consent_acknowledged', default: 0 })
  consentAcknowledged: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'remarks_sent', default: 0 })
  remarksSent: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'reminder_24h_sent', default: 0 })
  reminder24hSent: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'reminder_1h_sent', default: 0 })
  reminder1hSent: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'reminder_15m_sent', default: 0 })
  reminder15mSent: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'candidate_confirmed', default: 0 })
  candidateConfirmed: number;

  @Column({ type: 'date', name: 'scheduled_date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: 'varchar', length: 16, name: 'scheduled_time', nullable: true })
  scheduledTime: string | null;

  @Column({ type: 'varchar', length: 64, name: 'interview_type', nullable: true })
  interviewType: string | null;

  @Column({ type: 'varchar', length: 64, name: 'interview_mode', nullable: true })
  interviewMode: string | null;

  @Column({ type: 'varchar', length: 512, name: 'meeting_url', nullable: true })
  meetingUrl: string | null;

  @Column({ type: 'text', name: 'remarks_desc', nullable: true })
  remarksDesc: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
