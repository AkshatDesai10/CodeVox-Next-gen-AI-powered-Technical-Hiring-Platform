import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { AssessmentStatus } from '../assessment-status.enum';
import { EvaluationMode, ExperienceLevel, QuestionSourceMode } from '../../assessment-platform/shared/enums';

@Entity('assessments')
export class AssessmentMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', unsigned: true, name: 'duration_minutes', default: 60 })
  durationMinutes: number;

  @Column({ type: 'int', unsigned: true, name: 'total_marks', default: 0 })
  totalMarks: number;

  @Column({
    type: 'enum',
    enum: AssessmentStatus,
    default: AssessmentStatus.DRAFT,
  })
  status: AssessmentStatus;

  @Column({
    type: 'enum',
    enum: QuestionSourceMode,
    name: 'question_source',
    default: QuestionSourceMode.STATIC,
  })
  questionSource: QuestionSourceMode;

  @Column({
    type: 'enum',
    enum: EvaluationMode,
    name: 'evaluation_mode',
    default: EvaluationMode.TESTCASE,
  })
  evaluationMode: EvaluationMode;

  @Column({
    type: 'enum',
    enum: ExperienceLevel,
    name: 'experience_level',
    default: ExperienceLevel.MID,
  })
  experienceLevel: ExperienceLevel;

  @Column({ type: 'json', name: 'target_skills', nullable: true })
  targetSkills: string[] | null;

  @Column({ type: 'json', name: 'ai_config', nullable: true })
  aiConfig: Record<string, unknown> | null;

  @Column({ type: 'bigint', unsigned: true, name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
