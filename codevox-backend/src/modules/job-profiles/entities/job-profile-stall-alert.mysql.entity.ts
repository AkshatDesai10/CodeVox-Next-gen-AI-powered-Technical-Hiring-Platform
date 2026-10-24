import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('job_profile_stall_alerts')
export class JobProfileStallAlertMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_application_id' })
  jobApplicationId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id' })
  jobProfileId: string;

  @Column({ type: 'int', unsigned: true, name: 'stall_days' })
  stallDays: number;

  @CreateDateColumn({ type: 'timestamp', name: 'notified_at' })
  notifiedAt: Date;
}
