import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { EvaluationStrategyType } from '../shared/enums';

@Entity('evaluation_reviews')
export class EvaluationReviewMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'submission_id', nullable: true })
  submissionId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id' })
  candidateAssessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'enum', enum: EvaluationStrategyType, default: EvaluationStrategyType.TESTCASE })
  strategy: EvaluationStrategyType;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  score: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'max_score', default: 0 })
  maxScore: string;

  @Column({ type: 'json', nullable: true })
  strengths: string[] | null;

  @Column({ type: 'json', nullable: true })
  weaknesses: string[] | null;

  @Column({ type: 'json', nullable: true })
  recommendations: string[] | null;

  @Column({ type: 'json', name: 'rubric_json', nullable: true })
  rubricJson: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
