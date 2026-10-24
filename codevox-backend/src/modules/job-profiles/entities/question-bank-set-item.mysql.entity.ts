import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { QuestionBankSetMysql } from './question-bank-set.mysql.entity';
import { QuestionBankQuestionMysql } from './question-bank-question.mysql.entity';

@Entity('question_bank_set_items')
export class QuestionBankSetItemMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'set_id' })
  setId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => QuestionBankSetMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'set_id' })
  set: QuestionBankSetMysql;

  @ManyToOne(() => QuestionBankQuestionMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: QuestionBankQuestionMysql;
}
