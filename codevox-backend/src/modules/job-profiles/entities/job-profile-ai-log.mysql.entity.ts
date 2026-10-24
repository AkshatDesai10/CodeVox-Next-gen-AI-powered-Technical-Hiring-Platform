import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

/** Unified AI call log (job-profile + assessment/interview/eval operations). */
@Entity('job_profile_ai_logs')
export class JobProfileAiLogMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id', nullable: true })
  jobProfileId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id', nullable: true })
  candidateAssessmentId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id', nullable: true })
  assessmentId: string | null;

  @Column({ type: 'varchar', length: 64 })
  operation: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 64, name: 'prompt_hash', nullable: true })
  promptHash: string | null;

  @Column({ type: 'json', name: 'request_json', nullable: true })
  requestJson: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'response_json', nullable: true })
  responseJson: Record<string, unknown> | null;

  @Column({ type: 'int', name: 'prompt_tokens', nullable: true })
  promptTokens: number | null;

  @Column({ type: 'int', name: 'completion_tokens', nullable: true })
  completionTokens: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
