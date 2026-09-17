/**
 * Appointment-deposit seed helpers.
 *
 * Insert real `appointment_deposit` rows for the deposits integration spec so
 * the feature services + real SQL see genuine data. Builds on the shared
 * primitives in ../harness.ts (seedOrganization / seedAppointment) but lives
 * here so harness.ts stays domain-agnostic.
 *
 * A deposit references an appointment (FK, ON DELETE CASCADE), which itself
 * needs an assignee (user.id) and a lead. Callers that don't care about the
 * appointment can omit `appointmentId` and we seed one automatically, given an
 * `assignedToId` (a user in the same org).
 *
 * NOT-NULL columns with no default that the seed must supply:
 *  - `amountCents`, `stripeConnectedAccountId`, `expiresAt`.
 * `status` defaults to 'pending'; `currency` defaults to 'usd' at the DB level.
 */
import { randomUUID } from 'node:crypto';
import { appointmentDeposit, db } from '@borradh-workspace/database';
import { seedAppointment } from '../harness.js';

/** All valid deposit statuses (mirrors the deposit_status pgEnum). */
export type SeedDepositStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'refunded'
  | 'cancelled';

/**
 * Insert an `appointment_deposit` scoped to an org. Returns its id.
 *
 * @param input.organizationId  owning org (required)
 * @param input.appointmentId   existing appointment; auto-seeded if omitted
 * @param input.assignedToId    user to assign the auto-seeded appointment to
 *                              (required only when `appointmentId` is omitted)
 * @param input.amountCents     deposit amount; defaults to 5000 (=$50.00)
 * @param input.currency        ISO currency; defaults to 'usd'
 * @param input.status          deposit status; defaults to 'pending'
 * @param input.stripeCheckoutSessionId  present only when a Stripe session was
 *                              created. Leaving it null lets cancel-deposit run
 *                              WITHOUT touching Stripe (the service only calls
 *                              Stripe to expire an existing session).
 * @param input.stripePaymentIntentId    present only after payment.
 * @param input.stripeConnectedAccountId connected acct id; defaults to a fake.
 * @param input.expiresAt       expiry; defaults to 1 hour in the future.
 */
export async function seedDeposit(input: {
  organizationId: string;
  appointmentId?: string;
  assignedToId?: string;
  amountCents?: number;
  currency?: string;
  status?: SeedDepositStatus;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeConnectedAccountId?: string;
  expiresAt?: Date;
}): Promise<string> {
  const id = `dep_${randomUUID()}`;

  let appointmentId = input.appointmentId;
  if (!appointmentId) {
    if (!input.assignedToId) {
      throw new Error(
        'seedDeposit: pass either an appointmentId or an assignedToId so an ' +
          'appointment can be auto-seeded (appointment.assignedToId is NOT NULL).'
      );
    }
    appointmentId = await seedAppointment({
      organizationId: input.organizationId,
      assignedToId: input.assignedToId,
    });
  }

  await db.insert(appointmentDeposit).values({
    id,
    appointmentId,
    organizationId: input.organizationId,
    amountCents: input.amountCents ?? 5000,
    currency: input.currency ?? 'usd',
    status: input.status ?? 'pending',
    stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    stripeConnectedAccountId:
      input.stripeConnectedAccountId ?? `acct_${randomUUID()}`,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  });

  return id;
}
