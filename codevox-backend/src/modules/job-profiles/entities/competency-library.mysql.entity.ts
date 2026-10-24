import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { CompetencyCategory } from './job-profile-competency.mysql.entity';

@Entity('competency_library')
export class CompetencyLibraryMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: CompetencyCategory, default: CompetencyCategory.HARD })
  category: CompetencyCategory;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'decimal', precision: 4, scale: 1, name: 'default_target_score', nullable: true })
  defaultTargetScore: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'default_weight_pct', nullable: true })
  defaultWeightPct: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
