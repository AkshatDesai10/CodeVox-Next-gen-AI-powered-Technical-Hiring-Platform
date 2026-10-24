import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export enum InterviewSessionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('interview_sessions')
export class InterviewSessionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id' })
  assessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id', nullable: true })
  candidateAssessmentId: string | null;

  @Column({
    type: 'enum',
    enum: InterviewSessionStatus,
    default: InterviewSessionStatus.SCHEDULED,
  })
  status: InterviewSessionStatus;

  @Column({ type: 'datetime', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', name: 'ended_at', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
