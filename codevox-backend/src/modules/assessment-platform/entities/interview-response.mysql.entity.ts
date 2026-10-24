import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

@Entity('interview_responses')
export class InterviewResponseMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'session_id' })
  sessionId: string;

  @Column({ type: 'bigint', unsigned: true, name: 'question_id' })
  questionId: string;

  @Column({ type: 'mediumtext', nullable: true })
  transcript: string | null;

  @Column({ type: 'varchar', length: 500, name: 'audio_url', nullable: true })
  audioUrl: string | null;

  @Column({ type: 'int', unsigned: true, name: 'response_duration', nullable: true })
  responseDuration: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
