import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('interview_round_problem_snapshots')
export class InterviewRoundProblemSnapshotMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_application_id' })
  jobApplicationId: string;

  @Column({ type: 'varchar', length: 64, name: 'lead_id', nullable: true })
  leadId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'stage_id', nullable: true })
  stageId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'problem_id', nullable: true })
  problemId: string | null;

  @Column({ type: 'int', unsigned: true, name: 'problem_version_number', nullable: true })
  problemVersionNumber: number | null;

  @Column({ type: 'json', name: 'snapshot_json' })
  snapshotJson: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
