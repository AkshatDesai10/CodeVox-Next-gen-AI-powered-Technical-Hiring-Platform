import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InterviewRecordingStatus = 'recording' | 'completed' | 'failed';

@Entity('interview_recordings')
export class InterviewRecordingMysql {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'candidate_token', type: 'varchar', length: 128 })
  candidateToken: string;

  @Column({ name: 'portal_token', type: 'varchar', length: 128, nullable: true })
  portalToken: string | null;

  @Column({ name: 'stage_id', type: 'varchar', length: 64, nullable: true })
  stageId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  engine: string | null;

  @Column({ name: 'egress_id', type: 'varchar', length: 128 })
  egressId: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ name: 'recording_url', type: 'text' })
  recordingUrl: string;

  @Column({ type: 'enum', enum: ['recording', 'completed', 'failed'], default: 'recording' })
  status: InterviewRecordingStatus;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
