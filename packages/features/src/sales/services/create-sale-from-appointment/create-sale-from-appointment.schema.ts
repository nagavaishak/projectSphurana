import { createSaleFromAppointmentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for seeding a sale from an appointment.
 *
 * DERIVED from the canonical wire contract
 * (`createSaleFromAppointmentRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context onto it — wire -> server, so the two
 * cannot drift.
 */
export const createSaleFromAppointmentSchema =
  createSaleFromAppointmentRequestBase.extend({
    organizationId: z.string().min(1),
    createdById: z.string().min(1),
  });

export type CreateSaleFromAppointmentInput = z.input<
  typeof createSaleFromAppointmentSchema
>;
