import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

export enum CandidateQuestionResponseStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  EVALUATED = 'EVALUATED',
}

@Entity('candidate_question_responses')
export class CandidateQuestionResponseMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'candidate_assessment_id' })
  candidateAssessmentId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'json', name: 'response_json' })
  responseJson: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: CandidateQuestionResponseStatus,
    default: CandidateQuestionResponseStatus.DRAFT,
  })
  status: CandidateQuestionResponseStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
