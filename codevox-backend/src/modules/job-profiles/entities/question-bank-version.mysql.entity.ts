import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { QuestionBankQuestionMysql } from './question-bank-question.mysql.entity';

@Entity('question_bank_versions')
export class QuestionBankVersionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

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

  @ManyToOne(() => QuestionBankQuestionMysql, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: QuestionBankQuestionMysql;
}
