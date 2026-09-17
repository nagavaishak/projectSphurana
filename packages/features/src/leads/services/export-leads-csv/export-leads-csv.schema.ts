import type { z } from 'zod';
import { exportLeadsSchema } from '../export-leads/export-leads.schema.js';

/**
 * Same filters as the raw export — the CSV step only serialises what
 * `exportLeads` already selected. Reused verbatim so the two can never drift.
 */
export const exportLeadsCsvSchema = exportLeadsSchema;

export type ExportLeadsCsvInput = z.infer<typeof exportLeadsCsvSchema>;
