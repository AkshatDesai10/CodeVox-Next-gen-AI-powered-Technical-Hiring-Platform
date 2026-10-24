import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';
import { ColumnNumericTransformer } from '../../coding-round/coding-round-submission.entity';

/**
 * Frozen copy of each round a candidate attempted — name/type at attempt time.
 * Profile edits later must not change stage_name / stage_type here.
 */
@Entity('application_round_snapshots')
export class ApplicationRoundSnapshotMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'bigint', unsigned: true })
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id || String(this.id) === '0') {
      const ts = Date.now().toString();
      const rand = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
      this.id = ts + rand;
    }
  }

  @Column({ type: 'bigint', unsigned: true, name: 'job_application_id' })
  jobApplicationId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'stage_id', nullable: true })
  stageId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'stage_key', nullable: true })
  stageKey: string | null;

  @Column({ type: 'varchar', length: 64, name: 'stage_type' })
  stageType: string;

  /** Frozen display name from the moment of the attempt. */
  @Column({ type: 'varchar', length: 120, name: 'stage_name' })
  stageName: string;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 64, name: 'source_table' })
  sourceTable: string;

  @Column({ type: 'varchar', length: 64, name: 'source_id' })
  sourceId: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'score_pct',
    nullable: true,
    transformer: new ColumnNumericTransformer(),
  })
  scorePct: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  status: string | null;

  @Column({ type: 'timestamp', name: 'attempted_at', nullable: true })
  attemptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
