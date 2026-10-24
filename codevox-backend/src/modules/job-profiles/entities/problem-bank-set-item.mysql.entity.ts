import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { ProblemBankSetMysql } from './problem-bank-set.mysql.entity';
import { ProblemBankProblemMysql } from './problem-bank-problem.mysql.entity';

@Entity('problem_bank_set_items')
export class ProblemBankSetItemMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'set_id' })
  setId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_id' })
  problemId: string;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ProblemBankSetMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'set_id' })
  set: ProblemBankSetMysql;

  @ManyToOne(() => ProblemBankProblemMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem: ProblemBankProblemMysql;
}
