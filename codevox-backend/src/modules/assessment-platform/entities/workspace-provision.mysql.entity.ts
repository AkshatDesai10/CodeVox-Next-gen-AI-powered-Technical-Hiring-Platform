import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { WorkspaceProvisionStatus } from '../shared/enums';

@Entity('workspace_provisions')
export class WorkspaceProvisionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id' })
  candidateAssessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id', nullable: true })
  questionId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'template_slug', nullable: true })
  templateSlug: string | null;

  @Column({ type: 'varchar', length: 128, name: 'compose_project', nullable: true })
  composeProject: string | null;

  @Column({
    type: 'enum',
    enum: WorkspaceProvisionStatus,
    default: WorkspaceProvisionStatus.PROVISIONING,
  })
  status: WorkspaceProvisionStatus;

  @Column({ type: 'json', name: 'endpoints_json', nullable: true })
  endpointsJson: Record<string, string> | null;

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
