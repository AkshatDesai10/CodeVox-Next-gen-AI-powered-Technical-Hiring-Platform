import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export enum JobProfileApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('job_profile_approvals')
export class JobProfileApprovalMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'int', unsigned: true, name: 'version_number' })
  versionNumber: number;

  @Column({ type: 'bigint', unsigned: true, name: 'requested_by_user_id', nullable: true })
  requestedByUserId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'reviewer_user_id', nullable: true })
  reviewerUserId: string | null;

  @Column({ type: 'enum', enum: JobProfileApprovalStatus, default: JobProfileApprovalStatus.PENDING })
  status: JobProfileApprovalStatus;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'timestamp', name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
