import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('question_test_cases')
export class QuestionTestCaseMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'text' })
  input: string;

  @Column({ type: 'text', name: 'expected_output' })
  expectedOutput: string;

  @Column({ type: 'tinyint', name: 'is_hidden', default: 0 })
  isHidden: number;
}
