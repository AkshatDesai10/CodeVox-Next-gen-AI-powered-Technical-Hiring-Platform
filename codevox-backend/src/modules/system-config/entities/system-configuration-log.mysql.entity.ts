import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('system_configuration_logs')
export class SystemConfigurationLogMysql {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 128, name: 'config_key' })
  key: string;

  @Column({ type: 'text', name: 'old_value', nullable: true })
  oldValue: string | null;

  @Column({ type: 'text', name: 'new_value', nullable: true })
  newValue: string | null;

  @Column({ type: 'varchar', length: 255, name: 'changed_by', nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
