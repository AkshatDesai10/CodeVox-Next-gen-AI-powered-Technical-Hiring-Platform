import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { CandidateAssessmentStatus } from '../candidate-assessment-status.enum';

@Entity('candidate_assessments')
export class CandidateAssessmentMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id' })
  assessmentId: string;

  @Column({
    type: 'enum',
    enum: CandidateAssessmentStatus,
    default: CandidateAssessmentStatus.ASSIGNED,
  })
  status: CandidateAssessmentStatus;

  @Column({ type: 'datetime', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'ai_generated_percentage', nullable: true })
  aiGeneratedPercentage: number | null;
}
