import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export enum InterviewQuestionType {
  TECHNICAL = 'TECHNICAL',
  BEHAVIORAL = 'BEHAVIORAL',
  HR = 'HR',
  SYSTEM_DESIGN = 'SYSTEM_DESIGN',
  OTHER = 'OTHER',
}

@Entity('interview_questions')
export class InterviewQuestionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({
    type: 'enum',
    enum: InterviewQuestionType,
    name: 'question_type',
    default: InterviewQuestionType.TECHNICAL,
  })
  questionType: InterviewQuestionType;

  @Column({ type: 'int', unsigned: true, name: 'sequence_no', default: 1 })
  sequenceNo: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
