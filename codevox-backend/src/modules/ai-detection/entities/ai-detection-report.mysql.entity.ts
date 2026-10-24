import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../database/active-mysql-row';

export type AiDetectionSourceType = 'file' | 'text';

@Entity('ai_detection_reports')
export class AiDetectionReportMysql extends ActiveMysqlRow {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 191, name: 'examiner_name', nullable: true })
  examinerName: string | null;

  @Column({ type: 'enum', enum: ['file', 'text'], name: 'source_type' })
  sourceType: AiDetectionSourceType;

  @Column({ type: 'varchar', length: 255, name: 'document_title', nullable: true })
  documentTitle: string | null;

  @Column({ type: 'varchar', length: 255, name: 'file_name', nullable: true })
  fileName: string | null;

  @Column({ type: 'varchar', length: 128, name: 'mime_type', nullable: true })
  mimeType: string | null;

  @Column({ type: 'int', unsigned: true, name: 'file_size', nullable: true })
  fileSize: number | null;

  @Column({ type: 'int', unsigned: true, name: 'char_count', default: 0 })
  charCount: number;

  @Column({ type: 'int', unsigned: true, name: 'chunk_count', default: 1 })
  chunkCount: number;

  @Column({ type: 'varchar', length: 32, name: 'verdict', nullable: true })
  verdict: string | null;

  @Column({ type: 'double', name: 'confidence', nullable: true })
  confidence: number | null;

  @Column({ type: 'double', name: 'ai_probability', nullable: true })
  aiProbability: number | null;

  @Column({ type: 'double', name: 'human_probability', nullable: true })
  humanProbability: number | null;

  @Column({ type: 'double', name: 'perplexity', nullable: true })
  perplexity: number | null;

  @Column({ type: 'double', name: 'burstiness', nullable: true })
  burstiness: number | null;

  @Column({ type: 'double', name: 'entropy', nullable: true })
  entropy: number | null;

  @Column({ type: 'double', name: 'classifier_score', nullable: true })
  classifierScore: number | null;

  @Column({ type: 'json', name: 'flagged_segments', nullable: true })
  flaggedSegments: unknown[] | null;

  @Column({ type: 'text', name: 'text_preview', nullable: true })
  textPreview: string | null;

  @Column({ type: 'varchar', length: 64, name: 'provider_id', nullable: true })
  providerId: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 6, name: 'created_at' })
  createdAt: Date;
}
