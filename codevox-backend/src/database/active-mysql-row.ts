import { Column } from 'typeorm';

/** Soft-delete flag: active rows have `inactive = 0`. */
export abstract class ActiveMysqlRow {
  @Column({ type: 'tinyint', width: 1, name: 'inactive', default: 0 })
  inactive: number;
}
