import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('candidates')
export class CandidateMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 191 })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 1,
    name: 'experience_years',
    nullable: true,
  })
  experienceYears: string | null;

  @Column({ type: 'varchar', length: 191, name: 'current_company', nullable: true })
  currentCompany: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'current_ctc',
    nullable: true,
  })
  currentCtc: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'expected_ctc',
    nullable: true,
  })
  expectedCtc: string | null;

  @Column({ type: 'int', unsigned: true, name: 'notice_period_days', nullable: true })
  noticePeriodDays: number | null;

  @Column({ type: 'json', nullable: true })
  skills: string[] | null;

  @Column({ type: 'text', name: 'projects_summary', nullable: true })
  projectsSummary: string | null;

  @Column({ type: 'text', name: 'experience_summary', nullable: true })
  experienceSummary: string | null;

  @Column({ type: 'text', name: 'education_summary', nullable: true })
  educationSummary: string | null;

  @Column({ type: 'varchar', length: 500, name: 'resume_url', nullable: true })
  resumeUrl: string | null;

  @Column({
    type: 'enum',
    enum: ['ACTIVE', 'INACTIVE', 'BLACKLISTED'],
    default: 'ACTIVE',
  })
  status: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
