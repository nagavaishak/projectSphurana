import { z } from 'zod';
import { listAppointmentsSchema } from '../list-appointments/list-appointments.schema.js';

/**
 * Same filters as `listAppointments`, but the caller is identified by `userId`
 * instead of hand-computing `scopeToUserId`: the service resolves the caller's
 * organization role and derives the scope itself.
 *
 * `limit` defaults to 100 (not the 50 `listAppointmentsSchema` uses) because
 * that is the page size the authenticated calendar has always requested.
 */
export const listAppointmentsForMemberSchema = listAppointmentsSchema
  .omit({ scopeToUserId: true, limit: true })
  .extend({
    userId: z.string().min(1, 'User ID is required'),
    limit: z.coerce.number().min(1).max(500).optional().default(100),
  });

export type ListAppointmentsForMemberInput = z.input<
  typeof listAppointmentsForMemberSchema
>;

export type ListAppointmentsForMemberParsed = z.output<
  typeof listAppointmentsForMemberSchema
>;
