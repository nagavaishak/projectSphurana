import { lead } from '@borradh-workspace/database';
import { and, count, lt, sql } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  date: { type: 'UTF8' },
  total_leads: { type: 'INT64' },
  new_leads: { type: 'INT64' },
  status_new: { type: 'INT64' },
  status_contacted: { type: 'INT64' },
  status_booked: { type: 'INT64' },
  status_lost: { type: 'INT64' },
  source_manual: { type: 'INT64' },
  source_facebook: { type: 'INT64' },
  source_chatbot: { type: 'INT64' },
  source_meta_lead_form: { type: 'INT64' },
  source_website: { type: 'INT64' },
  source_referral: { type: 'INT64' },
  conversion_rate: { type: 'DOUBLE', optional: true },
};

export const leadsExporter: DomainExporter = {
  domain: 'leads',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const stats = await db
      .select({
        organizationId: lead.organizationId,
        total: count(),
        newLeads: sql<number>`count(*) filter (where ${lead.createdAt} >= ${dayStart.toISOString()} and ${lead.createdAt} <= ${dayEnd.toISOString()})`,
        statusNew: sql<number>`count(*) filter (where ${lead.status} = 'new')`,
        statusContacted: sql<number>`count(*) filter (where ${lead.status} = 'contacted')`,
        statusBooked: sql<number>`count(*) filter (where ${lead.status} = 'booked')`,
        statusLost: sql<number>`count(*) filter (where ${lead.status} = 'lost')`,
        sourceManual: sql<number>`count(*) filter (where ${lead.source} = 'manual')`,
        sourceFacebook: sql<number>`count(*) filter (where ${lead.source} in ('facebook', 'instagram'))`,
        sourceChatbot: sql<number>`count(*) filter (where ${lead.source} = 'whatsapp')`,
        sourceMetaLeadForm: sql<number>`count(*) filter (where ${lead.source} = 'meta_lead_form')`,
        sourceWebsite: sql<number>`count(*) filter (where ${lead.source} = 'website')`,
        sourceReferral: sql<number>`count(*) filter (where ${lead.source} = 'referral')`,
      })
      .from(lead)
      .where(and(lt(lead.createdAt, dayEnd), notDeleted(lead)))
      .groupBy(lead.organizationId);

    const rows = stats.map((s) => {
      const total = Number(s.total);
      const booked = Number(s.statusBooked);
      return {
        organization_id: s.organizationId,
        date: dateStr,
        total_leads: total,
        new_leads: Number(s.newLeads),
        status_new: Number(s.statusNew),
        status_contacted: Number(s.statusContacted),
        status_booked: booked,
        status_lost: Number(s.statusLost),
        source_manual: Number(s.sourceManual),
        source_facebook: Number(s.sourceFacebook),
        source_chatbot: Number(s.sourceChatbot),
        source_meta_lead_form: Number(s.sourceMetaLeadForm),
        source_website: Number(s.sourceWebsite),
        source_referral: Number(s.sourceReferral),
        conversion_rate: total > 0 ? booked / total : null,
      };
    });

    return toParquetBuffer(schema, rows);
  },
};
