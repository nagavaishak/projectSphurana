import { auditActionValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listAuditLogsSchema = z.object({
  organizationId: z.string().optional(),
  entityType: z.string().optional(),
  action: z.enum(auditActionValues).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
