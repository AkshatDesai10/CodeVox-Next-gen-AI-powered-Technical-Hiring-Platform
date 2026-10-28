import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** One row per voice / assessment round within a candidate interview journey. */
export enum AutonomousInterviewRoundType {
  AI_SCREENING = 'ai_screening',
  INTRO_VERBAL = 'intro_verbal',
  HR_VERBAL = 'hr_verbal',
  BND_ASSESSMENT = 'bnd_assessment',
  BND_INTERVIEW = 'bnd_interview',
  CODING = 'coding',
}

export enum AutonomousInterviewRoundStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

@Entity('autonomous_interview_rounds')
export class AutonomousInterviewRoundMysql {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'candidate_token' })
  candidateToken: string;

  @Column({
    type: 'enum',
    enum: AutonomousInterviewRoundType,
    name: 'round_type',
  })
  roundType: AutonomousInterviewRoundType;

  @Column({ type: 'varchar', length: 128, name: 'livekit_room_name', nullable: true })
  livekitRoomName: string | null;

  /** Round audit / transcript payload (replaces hardcoded master audit columns). */
  @Column({ type: 'json', name: 'chat_transcript', nullable: true })
  chatTranscript: object | null;

  @Column({ type: 'text', name: 'merged_recording_url', nullable: true })
  mergedRecordingUrl: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'ai_score', nullable: true })
  aiScore: number | null;

  @Column({
    type: 'enum',
    enum: AutonomousInterviewRoundStatus,
    name: 'status',
    default: AutonomousInterviewRoundStatus.IN_PROGRESS,
  })
  status: AutonomousInterviewRoundStatus;

  @Column({ type: 'varchar', length: 128, name: 'livekit_egress_id', nullable: true })
  livekitEgressId: string | null;

  @Column({ type: 'timestamp', name: 'recording_started_at', nullable: true })
  recordingStartedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
