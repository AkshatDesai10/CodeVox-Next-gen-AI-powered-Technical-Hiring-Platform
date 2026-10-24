import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('recruitment_lead_interview_link')
export class RecruitmentLeadInterviewLinkMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'lead_id' })
  leadId: string;

  @Column({ type: 'varchar', length: 64, name: 'interview_ref_id', nullable: true })
  interviewRefId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'local_interview_overlay_id', nullable: true })
  localInterviewOverlayId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'local_application_token', nullable: true })
  localApplicationToken: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}

@Entity('recruitment_communication_log')
export class RecruitmentCommunicationLogMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'lead_id' })
  leadId: string;

  @Column({ type: 'varchar', length: 32 })
  channel: string;

  @Column({ type: 'varchar', length: 16, default: 'outbound' })
  direction: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 64, name: 'sent_by', nullable: true })
  sentBy: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'sent_at' })
  sentAt: Date;
}

@Entity('recruitment_activity_log')
export class RecruitmentActivityLogMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'lead_id', nullable: true })
  leadId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'interview_ref_id', nullable: true })
  interviewRefId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar', length: 512, name: 'event_summary' })
  eventSummary: string;

  @Column({ type: 'json', name: 'event_json', nullable: true })
  eventJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, name: 'actor_id', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'occurred_at' })
  occurredAt: Date;
}

@Entity('recruitment_interview_status_history')
export class RecruitmentInterviewStatusHistoryMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'interview_overlay_id' })
  interviewOverlayId: string;

  @Column({ type: 'varchar', length: 64, name: 'from_status', nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 64, name: 'to_status' })
  toStatus: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 64, name: 'changed_by', nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'changed_at' })
  changedAt: Date;
}
