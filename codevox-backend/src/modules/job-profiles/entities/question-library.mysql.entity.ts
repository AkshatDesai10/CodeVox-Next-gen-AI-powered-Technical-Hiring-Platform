import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { JobQuestionKind } from './job-profile-question.mysql.entity';

@Entity('question_library')
export class QuestionLibraryMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'enum', enum: JobQuestionKind, default: JobQuestionKind.MANUAL })
  kind: JobQuestionKind;

  @Column({ type: 'varchar', length: 64, name: 'stage_type', nullable: true })
  stageType: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
