import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ActiveMysqlRow } from '../../../../database/active-mysql-row';

export enum AssessmentTemplateStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

@Entity('assessment_templates')
export class AssessmentTemplateMysql extends ActiveMysqlRow {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120 })
  role: string;

  @Column({ type: 'enum', enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM' })
  difficulty: string;

  @Column({ type: 'varchar', length: 64, name: 'assessment_type', default: 'TECHNICAL' })
  assessmentType: string;

  @Column({ type: 'bigint', unsigned: true, name: 'assessment_id', nullable: true })
  assessmentId: string | null;

  @Column({ type: 'json', name: 'template_json' })
  templateJson: Record<string, unknown>;

  @Column({ type: 'enum', enum: AssessmentTemplateStatus, default: AssessmentTemplateStatus.DRAFT })
  status: AssessmentTemplateStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
