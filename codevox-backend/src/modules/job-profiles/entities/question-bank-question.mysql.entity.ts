import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export enum QuestionBankType {
  INTRO = 'intro',
  BEHAVIORAL = 'behavioral',
  SITUATIONAL = 'situational',
  COMPETENCY_BASED = 'competency_based',
  TECHNICAL = 'technical',
  CULTURE_FIT = 'culture_fit',
}

export enum QuestionBankDifficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

export enum QuestionBankStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('question_bank_questions')
export class QuestionBankQuestionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'longtext', name: 'question_text' })
  questionText: string;

  @Column({ type: 'text', name: 'question_text_plain', nullable: true })
  questionTextPlain: string | null;

  @Column({ type: 'enum', enum: QuestionBankType, name: 'question_type', default: QuestionBankType.TECHNICAL })
  questionType: QuestionBankType;

  @Column({ type: 'enum', enum: QuestionBankDifficulty, default: QuestionBankDifficulty.MEDIUM })
  difficulty: QuestionBankDifficulty;

  @Column({ type: 'enum', enum: QuestionBankStatus, default: QuestionBankStatus.DRAFT })
  status: QuestionBankStatus;

  @Column({ type: 'json', name: 'competency_tags', nullable: true })
  competencyTags: string[] | null;

  @Column({ type: 'json', name: 'topic_tags', nullable: true })
  topicTags: string[] | null;

  @Column({ type: 'longtext', name: 'expected_answer_notes', nullable: true })
  expectedAnswerNotes: string | null;

  @Column({ type: 'json', name: 'ideal_answer_keywords', nullable: true })
  idealAnswerKeywords: string[] | null;

  @Column({ type: 'text', name: 'follow_up_question', nullable: true })
  followUpQuestion: string | null;

  @Column({ type: 'text', name: 'follow_up_trigger', nullable: true })
  followUpTrigger: string | null;

  @Column({ type: 'json', name: 'red_flag_signals', nullable: true })
  redFlagSignals: string[] | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'bias_check_passed', default: 1 })
  biasCheckPassed: number;

  @Column({ type: 'text', name: 'bias_check_notes', nullable: true })
  biasCheckNotes: string | null;

  @Column({ type: 'int', unsigned: true, name: 'time_guidance_seconds', nullable: true })
  timeGuidanceSeconds: number | null;

  @Column({ type: 'int', unsigned: true, name: 'usage_count', default: 0 })
  usageCount: number;

  @Column({ type: 'int', unsigned: true, name: 'sessions_asked_count', default: 0 })
  sessionsAskedCount: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'avg_answer_duration_seconds', nullable: true })
  avgAnswerDurationSeconds: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'avg_ai_score', nullable: true })
  avgAiScore: string | null;

  @Column({ type: 'tinyint', unsigned: true, name: 'low_signal_flag', default: 0 })
  lowSignalFlag: number;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'updated_by_user_id', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
