import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

@Entity('assessment_session_submissions')
export class AssessmentSessionSubmissionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'varchar', length: 64, name: 'section_id' })
  sectionId: string;

  @Column({ type: 'varchar', length: 64, name: 'submission_type' })
  submissionType: string;

  @Column({ type: 'json', name: 'submission_data' })
  submissionData: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
