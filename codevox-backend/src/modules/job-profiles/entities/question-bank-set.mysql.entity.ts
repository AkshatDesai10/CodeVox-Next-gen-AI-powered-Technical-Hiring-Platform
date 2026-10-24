import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { QuestionBankStatus } from './question-bank-question.mysql.entity';

@Entity('question_bank_sets')
export class QuestionBankSetMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: QuestionBankStatus, default: QuestionBankStatus.DRAFT })
  status: QuestionBankStatus;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
