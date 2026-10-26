import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('recruitment_interview_time_slots')
export class RecruitmentInterviewTimeSlotMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  /** Legacy / unused — slots are reusable time windows; invite picks the date. */
  @Column({ type: 'date', name: 'slot_date', nullable: true })
  slotDate: string | null;

  @Column({ type: 'time', name: 'start_time' })
  startTime: string;

  @Column({ type: 'time', name: 'end_time' })
  endTime: string;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Kolkata' })
  timezone: string;

  @Column({ type: 'int', unsigned: true, default: 1 })
  capacity: number;

  @Column({ type: 'int', unsigned: true, name: 'booked_count', default: 0 })
  bookedCount: number;

  /** open | closed */
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
