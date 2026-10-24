import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('job_profile_preview_audit')
export class JobProfilePreviewAuditMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'recruiter_user_id', nullable: true })
  recruiterUserId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'candidate_token' })
  candidateToken: string;

  @Column({ type: 'json', nullable: true })
  events: Record<string, unknown>[] | null;

  @CreateDateColumn({ type: 'timestamp', name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamp', name: 'ended_at', nullable: true })
  endedAt: Date | null;
}
