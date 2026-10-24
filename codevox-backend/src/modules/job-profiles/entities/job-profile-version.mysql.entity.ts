import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('job_profile_versions')
export class JobProfileVersionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'int', unsigned: true, name: 'version_number' })
  versionNumber: number;

  @Column({ type: 'json' })
  snapshot: Record<string, unknown>;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
