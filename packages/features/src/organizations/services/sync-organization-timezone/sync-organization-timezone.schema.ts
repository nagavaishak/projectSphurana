import { z } from 'zod';

export const syncOrganizationTimezoneSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Overwrite a timezone that is already set to something other than `'UTC'`.
   *
   * Default `false`: only an org still on the `'UTC'` column default is written,
   * so this can be called freely (on every location write, in a backfill) with
   * no risk of walking over a value someone chose deliberately.
   *
   * Pass `true` only when the location's own geography changed — an address
   * edit that moves the business to another zone SHOULD move its timezone.
   */
  force: z.boolean().optional().default(false),
});

export type SyncOrganizationTimezoneInput = z.input<
  typeof syncOrganizationTimezoneSchema
>;
