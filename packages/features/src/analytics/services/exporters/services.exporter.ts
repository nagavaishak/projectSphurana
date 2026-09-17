import { organizationService } from '@borradh-workspace/database';
import type { DbConnection } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  date: { type: 'UTF8' },
  service_name: { type: 'UTF8' },
  category: { type: 'UTF8' },
  deposit_amount_cents: { type: 'INT64', optional: true },
  pricing_description: { type: 'UTF8', optional: true },
  is_active: { type: 'BOOLEAN' },
};

export const servicesExporter: DomainExporter = {
  domain: 'services',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';

    // Current-state snapshot of all services
    const services = await db
      .select({
        organizationId: organizationService.organizationId,
        name: organizationService.name,
        category: organizationService.category,
        depositAmountCents: organizationService.depositAmountCents,
        priceText: organizationService.priceText,
        isActive: organizationService.isActive,
      })
      .from(organizationService);

    const rows = services.map((s) => ({
      organization_id: s.organizationId,
      date: dateStr,
      service_name: s.name,
      category: s.category,
      deposit_amount_cents: s.depositAmountCents ?? 0,
      pricing_description: s.priceText ?? null,
      is_active: s.isActive,
    }));

    return toParquetBuffer(schema, rows);
  },
};
