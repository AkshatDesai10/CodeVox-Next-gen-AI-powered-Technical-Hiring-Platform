import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

export enum WorkspaceRecordStatus {
  PROVISIONING = 'PROVISIONING',
  READY = 'READY',
  FAILED = 'FAILED',
  TEARDOWN = 'TEARDOWN',
}

@Entity('assessment_workspaces')
export class AssessmentWorkspaceMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'varchar', length: 64, name: 'workspace_type' })
  workspaceType: string;

  @Column({ type: 'json', name: 'workspace_config_json' })
  workspaceConfigJson: Record<string, unknown>;

  @Column({ type: 'enum', enum: WorkspaceRecordStatus, default: WorkspaceRecordStatus.PROVISIONING })
  status: WorkspaceRecordStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
