import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

@Entity('evaluation_results')
export class EvaluationResultMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'submission_id', nullable: true })
  submissionId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'section_id', nullable: true })
  sectionId: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  score: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'max_score', default: 0 })
  maxScore: string;

  @Column({ type: 'json', name: 'evaluation_json' })
  evaluationJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
