import { updateAppointmentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Base schema without refinements (for DTOs with createZodDto).
 *
 * DERIVED from the canonical wire contract (`updateAppointmentRequestBase` in
 * `@borradh-workspace/contracts`) by extending the route param and the
 * server-injected context onto it. Field rules and the PATCH-semantics
 * `.optional().nullable()` pairs live in the contract; do not restate them here.
 *
 * `startDate` / `endDate` are re-typed to `z.coerce.date()`: the wire carries
 * ISO strings, the service wants `Date`s. Optionality still comes from the
 * contract.
 */
export const updateAppointmentBaseSchema = updateAppointmentRequestBase.extend({
  id: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Full schema with refinements (for service validation).
// Mirrored on `updateAppointmentRequestSchema` — the strict wire half — because
// a `.refine()` cannot be carried across `.extend()`.
export const updateAppointmentSchema = updateAppointmentBaseSchema.refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return data.endDate > data.startDate;
    }
    return true;
  },
  {
    message: 'End date must be after start date',
    path: ['endDate'],
  }
);

/**
 * Input type (what callers provide) — `z.input`, not `z.infer`, matching the
 * create-appointment convention. The service `safeParse`s its argument, so the
 * parameter type must describe the UNPARSED body: the API DTO now hands the
 * wire's ISO date STRINGS straight through and `z.coerce.date()` converts them,
 * exactly as it always did for `create`.
 */
export type UpdateAppointmentInput = z.input<typeof updateAppointmentSchema>;
