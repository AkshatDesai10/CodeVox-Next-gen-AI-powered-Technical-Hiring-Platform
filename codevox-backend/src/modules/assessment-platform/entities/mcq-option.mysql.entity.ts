import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('mcq_options')
export class McqOptionMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'varchar', length: 8 })
  label: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'tinyint', name: 'is_correct', default: 0 })
  isCorrect: number;

  @Column({ type: 'int', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;
}
