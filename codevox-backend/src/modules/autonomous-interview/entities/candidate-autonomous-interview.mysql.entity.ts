import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export enum AutonomousInterviewPhase {
  INTRO_VERBAL = 'intro_verbal',
  SANDBOX_CODE = 'sandbox_code',
  HR_VERBAL = 'hr_verbal',
  CLOSING = 'closing',
  COMPLETED = 'completed',
  AI_SCREENING = 'ai_screening',
  BND_ASSESSMENT = 'bnd_assessment',
  BND_INTERVIEW = 'bnd_interview',
}

export enum AutonomousInterviewDecision {
  AUTO_REJECT = 'AUTO_REJECT',
  AUTO_PASS_TO_OFFER = 'AUTO_PASS_TO_OFFER',
  UNDER_REVIEW = 'UNDER_REVIEW',
}

@Entity('candidate_autonomous_interviews')
export class CandidateAutonomousInterviewMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'candidate_token' })
  candidateToken: string;

  @Column({ type: 'bigint', unsigned: true, name: 'job_profile_id', nullable: true })
  jobProfileId: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'is_preview', default: 0 })
  isPreview: number;

  @Column({
    type: 'enum',
    enum: AutonomousInterviewPhase,
    name: 'current_phase',
    default: AutonomousInterviewPhase.INTRO_VERBAL,
  })
  currentPhase: AutonomousInterviewPhase;

  @Column({ type: 'json', name: 'stage1_chat_history', nullable: true })
  stage1ChatHistory: object | null;

  @Column({ type: 'json', name: 'stage3_chat_history', nullable: true })
  stage3ChatHistory: object | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'stage1_voice_score', default: 0 })
  stage1VoiceScore: number;

  @Column({ type: 'text', name: 'submitted_code', nullable: true })
  submittedCode: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'code_quality_score', nullable: true })
  codeQualityScore: number | null;

  @Column({ type: 'json', name: 'architectural_flaws', nullable: true })
  architecturalFlaws: string[] | null;

  @Column({
    type: 'enum',
    enum: AutonomousInterviewDecision,
    name: 'final_decision',
    default: AutonomousInterviewDecision.UNDER_REVIEW,
  })
  finalDecision: AutonomousInterviewDecision;

  /** Current active LiveKit room (mirrors the in-progress round's room). */
  @Column({ type: 'varchar', length: 128, name: 'livekit_room_name', nullable: true })
  livekitRoomName: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id', nullable: true })
  candidateAssessmentId: string | null;

  @Column({ type: 'varchar', length: 100, name: 'tech_stack', nullable: true })
  techStack: string | null;

  @Column({ type: 'json', name: 'resume_skills', nullable: true })
  resumeSkills: string[] | null;

  @Column({ type: 'timestamp', name: 'consent_recorded_at', nullable: true })
  consentRecordedAt: Date | null;

  @Column({ type: 'timestamp', name: 'identity_verified_at', nullable: true })
  identityVerifiedAt: Date | null;

  @Column({ type: 'json', name: 'reference_face_descriptor', nullable: true })
  referenceFaceDescriptor: number[] | null;

  @Column({ type: 'timestamp', name: 'liveness_verified_at', nullable: true })
  livenessVerifiedAt: Date | null;

  @Column({ type: 'enum', enum: ['challenge', 'vendor'], name: 'liveness_method', nullable: true })
  livenessMethod: 'challenge' | 'vendor' | null;

  @Column({ type: 'json', name: 'voice_reference_embedding', nullable: true })
  voiceReferenceEmbedding: number[] | null;

  @Column({ type: 'json', name: 'proctor_summary', nullable: true })
  proctorSummary: object | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  /**
   * Hydrated from `autonomous_interview_rounds` (not DB columns on this table).
   * Kept so existing report / audit consumers keep working after the 3-table split.
   */
  stage1VoiceAudit?: object | null;
  hrVoiceAudit?: object | null;
  screeningVoiceAudit?: object | null;
  recordingUrl?: string | null;
  livekitEgressId?: string | null;
  recordingStartedAt?: Date | null;
}
