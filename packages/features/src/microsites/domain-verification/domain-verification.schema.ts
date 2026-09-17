import { z } from 'zod';

/** The repeatable sweep carries nothing — it finds its own work. */
export const verifySweepJobSchema = z.object({
  /** Optional cap for a manual/backfill run. */
  limit: z.number().int().positive().max(1000).optional(),
});

export type VerifySweepJobPayload = z.infer<typeof verifySweepJobSchema>;

/**
 * Contract §4. Emitted the moment a site's PRIMARY host changes — including
 * the first change, `{slug}.borradh.io` → `salon.com`, which is the one people
 * forget is a change at all.
 */
export const domainChangedJobSchema = z.object({
  micrositeId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The `microsite_domain` row that became primary — the dedup key. */
  domainId: z.string().min(1),
  /** The host that WAS primary. Stays alive forever as a 301 source. */
  previousHost: z.string().min(1),
  /** The host that is primary now. */
  newHost: z.string().min(1),
});

export type DomainChangedJobPayload = z.infer<typeof domainChangedJobSchema>;
