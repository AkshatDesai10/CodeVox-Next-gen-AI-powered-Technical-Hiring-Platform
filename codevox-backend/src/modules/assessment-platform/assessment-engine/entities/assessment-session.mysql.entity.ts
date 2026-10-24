import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

export enum AssessmentSessionStatus {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  GRADED = 'GRADED',
}

@Entity('assessment_sessions')
export class AssessmentSessionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id', nullable: true })
  assessmentId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id', nullable: true })
  candidateAssessmentId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'template_id', nullable: true })
  templateId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  role: string | null;

  @Column({ type: 'json', name: 'assessment_json', nullable: true })
  assessmentJson: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: AssessmentSessionStatus, default: AssessmentSessionStatus.ASSIGNED })
  status: AssessmentSessionStatus;

  @Column({ type: 'datetime', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
