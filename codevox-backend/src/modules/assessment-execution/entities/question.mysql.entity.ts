import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { QuestionType } from '../question-type.enum';
import { QuestionOrigin } from '../../assessment-platform/shared/enums';

@Entity('questions')
export class QuestionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: QuestionType,
    name: 'question_type',
    default: QuestionType.CODING,
  })
  questionType: QuestionType;

  @Column({
    type: 'enum',
    enum: ['EASY', 'MEDIUM', 'HARD'],
    default: 'MEDIUM',
  })
  difficulty: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  marks: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  language: string | null;

  @Column({ type: 'enum', enum: QuestionOrigin, default: QuestionOrigin.STATIC })
  source: QuestionOrigin;

  @Column({ type: 'json', name: 'environment_config', nullable: true })
  environmentConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'evaluation_config', nullable: true })
  evaluationConfig: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'ai_metadata', nullable: true })
  aiMetadata: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'question_json', nullable: true })
  questionJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, name: 'workspace_type', nullable: true })
  workspaceType: string | null;

  @Column({
    type: 'enum',
    enum: ['TESTCASE', 'AI', 'HYBRID'],
    name: 'evaluation_mode',
    nullable: true,
  })
  evaluationMode: string | null;

  @Column({ type: 'int', unsigned: true, name: 'estimated_duration', nullable: true })
  estimatedDuration: number | null;

  @Column({
    type: 'enum',
    enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
    default: 'ACTIVE',
  })
  status: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
