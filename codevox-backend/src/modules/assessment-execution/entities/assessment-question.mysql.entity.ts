import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('assessment_questions')
export class AssessmentQuestionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id' })
  assessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  marks: number;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'tinyint', name: 'mandatory', default: 1 })
  mandatory: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
