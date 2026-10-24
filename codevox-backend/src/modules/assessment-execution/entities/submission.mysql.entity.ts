import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { SubmissionStatus } from '../submission-status.enum';

@Entity('submissions')
export class SubmissionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id' })
  candidateAssessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'varchar', length: 50 })
  language: string;

  @Column({ type: 'mediumtext', name: 'source_code' })
  sourceCode: string;

  @Column({ type: 'mediumtext', name: 'execution_output', nullable: true })
  executionOutput: string | null;

  @Column({ type: 'json', name: 'ai_evaluation', nullable: true })
  aiEvaluation: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'ai_detection', nullable: true })
  aiDetection: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'ai_code_evaluation', nullable: true })
  aiCodeEvaluation: Record<string, unknown> | null;

  @Column({ type: 'bigint', unsigned: true, name: 'evaluation_review_id', nullable: true })
  evaluationReviewId: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'int', unsigned: true, name: 'execution_time', nullable: true })
  executionTime: number | null;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.PENDING,
  })
  status: SubmissionStatus;

  @Column({ type: 'decimal', precision: 5, scale: 4, name: 'plagiarism_score', nullable: true })
  plagiarismScore: string | null;

  @Column({ type: 'tinyint', name: 'plagiarism_flagged', default: 0 })
  plagiarismFlagged: number;

  @Column({ type: 'datetime', name: 'plagiarism_checked_at', nullable: true })
  plagiarismCheckedAt: Date | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'ai_probability', nullable: true })
  aiProbability: number | null;

  @Column({ type: 'datetime', name: 'ai_checked_at', nullable: true })
  aiCheckedAt: Date | null;

  @Column({ type: 'datetime', name: 'ai_code_evaluation_checked_at', nullable: true })
  aiCodeEvaluationCheckedAt: Date | null;
}
