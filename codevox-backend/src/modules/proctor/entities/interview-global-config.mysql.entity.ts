import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum InterviewLivenessProvider {
  CHALLENGE = 'challenge',
  VENDOR = 'vendor',
}

@Entity('interview_global_config')
export class InterviewGlobalConfigMysql {
  @PrimaryColumn({ type: 'tinyint', unsigned: true, default: 1 })
  id: number;

  @Column({ type: 'text', name: 'consent_text' })
  consentText: string;

  @Column({ type: 'int', unsigned: true, name: 'proctor_face_check_interval_ms', default: 3000 })
  proctorFaceCheckIntervalMs: number;

  @Column({ type: 'float', name: 'proctor_face_match_threshold', default: 0.55 })
  proctorFaceMatchThreshold: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'require_camera_for_start', default: 1 })
  requireCameraForStart: number;

  @Column({ type: 'tinyint', unsigned: true, name: 'require_voice_enroll', default: 1 })
  requireVoiceEnroll: number;

  @Column({
    type: 'enum',
    enum: InterviewLivenessProvider,
    name: 'liveness_provider',
    default: InterviewLivenessProvider.CHALLENGE,
  })
  livenessProvider: InterviewLivenessProvider;

  @Column({ type: 'float', name: 'voice_drift_threshold', default: 0.35 })
  voiceDriftThreshold: number;

  @Column({ type: 'int', unsigned: true, name: 'ai_cheat_pause_ms', default: 2500 })
  aiCheatPauseMs: number;

  @Column({ type: 'int', unsigned: true, name: 'ai_cheat_min_words', default: 12 })
  aiCheatMinWords: number;

  @Column({ type: 'int', unsigned: true, name: 'fraud_risk_review_threshold', default: 8 })
  fraudRiskReviewThreshold: number;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
