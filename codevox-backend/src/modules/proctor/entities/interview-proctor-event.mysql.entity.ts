import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum InterviewProctorSessionType {
  CANDIDATE_INTERVIEW = 'candidate_interview',
  STUDENT_VIVA = 'student_viva',
}

export enum InterviewProctorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

@Entity('interview_proctor_events')
export class InterviewProctorEventMysql {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'session_token' })
  sessionToken: string;

  @Column({
    type: 'enum',
    enum: InterviewProctorSessionType,
    name: 'session_type',
    default: InterviewProctorSessionType.CANDIDATE_INTERVIEW,
  })
  sessionType: InterviewProctorSessionType;

  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType: string;

  @Column({
    type: 'enum',
    enum: InterviewProctorSeverity,
    name: 'severity',
  })
  severity: InterviewProctorSeverity;

  @Column({ type: 'json', nullable: true })
  payload: object | null;

  @Column({ type: 'bigint', name: 'client_ts', nullable: true })
  clientTs: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
