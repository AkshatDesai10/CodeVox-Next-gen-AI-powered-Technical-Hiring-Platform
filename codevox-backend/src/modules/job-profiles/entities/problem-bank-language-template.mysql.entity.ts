import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { ProblemBankProblemMysql } from './problem-bank-problem.mysql.entity';

@Entity('problem_bank_language_templates')
export class ProblemBankLanguageTemplateMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_id' })
  problemId: string;

  @Column({ type: 'varchar', length: 32, name: 'language_code' })
  languageCode: string;

  @Column({ type: 'longtext', name: 'starter_code', nullable: true })
  starterCode: string | null;

  @Column({ type: 'longtext', name: 'internal_solution', nullable: true })
  internalSolution: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ProblemBankProblemMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem: ProblemBankProblemMysql;
}
