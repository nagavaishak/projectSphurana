import { saleStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listSalesSchema = z.object({
  organizationId: z.string().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(saleStatusValues).optional(),
  leadId: z.string().min(1).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. A sale rings
   * through one till, so this is a plain equality — rows with a NULL
   * `location_id` predate the backfill (plan §2.1) and are deliberately not
   * matched, rather than shown at every branch's till.
   */
  locationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListSalesInput = z.input<typeof listSalesSchema>;
