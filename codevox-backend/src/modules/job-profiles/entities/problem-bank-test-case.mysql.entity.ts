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

@Entity('problem_bank_test_cases')
export class ProblemBankTestCaseMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_id' })
  problemId: string;

  @Column({ type: 'longtext', name: 'input_value' })
  inputValue: string;

  @Column({ type: 'longtext', name: 'expected_output' })
  expectedOutput: string;

  @Column({ type: 'tinyint', unsigned: true, name: 'is_visible', default: 1 })
  isVisible: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'is_hidden', default: 0 })
  isHidden: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'is_edge_case', default: 0 })
  isEdgeCase: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ProblemBankProblemMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem: ProblemBankProblemMysql;
}
