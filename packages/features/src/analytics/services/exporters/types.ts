import type { DbConnection } from '../../../shared/index.js';

export interface DomainExporter {
  domain: string;
  export(db: DbConnection, date: Date): Promise<Buffer>;
}
