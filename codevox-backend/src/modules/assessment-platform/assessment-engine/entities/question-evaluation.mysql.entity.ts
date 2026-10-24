import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

@Entity('question_evaluations')
export class QuestionEvaluationMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'response_id' })
  responseId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id' })
  candidateAssessmentId: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  score: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'max_score', default: 0 })
  maxScore: string;

  @Column({ type: 'json', name: 'evaluation_json' })
  evaluationJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
