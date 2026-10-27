import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_configurations')
export class SystemConfigurationMysql {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'config_key' })
  configKey: string;

  @Column({ type: 'text', name: 'config_value', nullable: true })
  configValue: string | null;

  @Column({ type: 'varchar', length: 64, name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
