import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { ProblemBankProblemMysql } from './problem-bank-problem.mysql.entity';

@Entity('problem_bank_versions')
export class ProblemBankVersionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_id' })
  problemId: string;

  @Column({ type: 'int', unsigned: true, name: 'version_number' })
  versionNumber: number;

  @Column({ type: 'json' })
  snapshot: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, name: 'change_summary', nullable: true })
  changeSummary: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ProblemBankProblemMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem: ProblemBankProblemMysql;
}
