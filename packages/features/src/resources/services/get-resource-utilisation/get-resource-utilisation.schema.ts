import { z } from 'zod';

export const getResourceUtilisationSchema = z.object({
  organizationId: z.string().min(1),
  /** Window start (inclusive). */
  from: z.coerce.date(),
  /** Window end (exclusive). */
  to: z.coerce.date(),
  /**
   * Restrict to one location. Location-LESS resources (a trolley-mounted
   * device) are available everywhere, so they are always included.
   */
  locationId: z.string().min(1).nullish(),
});

export type GetResourceUtilisationInput = z.input<
  typeof getResourceUtilisationSchema
>;
