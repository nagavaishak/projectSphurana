import {
  type AppointmentDeposit,
  appointment,
  appointmentDeposit,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  formatDateInOrgZone,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type CreateDepositRequestInput,
  createDepositRequestSchema,
} from './create-deposit-request.schema.js';

export interface DepositRequestResult {
  deposit: AppointmentDeposit;
  checkoutUrl: string;
}

/**
 * Create a deposit request for an appointment
 */
const createDepositRequestImpl = async (
  db: DbConnection,
  input: CreateDepositRequestInput
): Promise<Result<DepositRequestResult>> => {
  const parsed = createDepositRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    appointmentId,
    organizationId,
    amountCents,
    currency,
    expirationHours,
    successUrl,
    cancelUrl,
  } = parsed.data;

  try {
    // Verify appointment exists and belongs to organization
    const existingAppointment = await db.query.appointment.findFirst({
      where: (t, { and, eq: eqOp, isNull }) =>
        and(
          eqOp(t.id, appointmentId),
          eqOp(t.organizationId, organizationId),
          isNull(t.deletedAt)
        ),
    });

    if (!existingAppointment) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found')
      );
    }

    // Get organization's Stripe Connect integration
    const integration = await db.query.stripeConnectIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    if (!integration) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe Connect not configured. Please connect your Stripe account first.'
        )
      );
    }

    if (!integration.isActive) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe Connect integration is not active'
        )
      );
    }

    if (!integration.chargesEnabled) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe account cannot accept payments. Please complete your Stripe account setup.'
        )
      );
    }

    // Check if there's already a pending deposit for this appointment
    const existingDeposit = await db.query.appointmentDeposit.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.appointmentId, appointmentId), eqOp(t.status, 'pending')),
    });

    if (existingDeposit) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A pending deposit request already exists for this appointment'
        )
      );
    }

    // How long the slot is held for. ONE org-level window governs both flavours
    // of hold — awaiting a deposit, and Claire holding while the customer
    // decides — because both are "hours to keep an unpaid slot". It lives on
    // `organization`, not on the Stripe integration row, so a clinic with no
    // Stripe account still has a hold policy.
    //
    // The same row also carries the zone used to print the appointment date on
    // the Stripe checkout page below — that description is read by the CLIENT,
    // so a UTC render is not merely untidy, it can name the wrong day.
    const holdOrg = await db.query.organization.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, organizationId),
      columns: { holdExpirationHours: true, timezone: true },
    });
    const hours = expirationHours ?? holdOrg?.holdExpirationHours ?? 24;
    const orgTimeZone = holdOrg?.timezone ?? 'UTC';
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    // A deposit is for this appointment's service. Its optional override is
    // passed through to Stripe; null deliberately means the clinic's Tax
    // Settings preset should classify the line.
    const service = existingAppointment.serviceId
      ? await db.query.organizationService.findFirst({
          columns: { taxCode: true },
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(
              eqOp(t.id, existingAppointment.serviceId as string),
              eqOp(t.organizationId, organizationId)
            ),
        })
      : null;

    // Create Stripe checkout session
    const stripeConnect = getStripeConnectService();
    const checkoutResult = await stripeConnect.createDepositCheckout({
      connectedAccountId: integration.stripeAccountId,
      amountCents,
      currency,
      productName: 'Appointment Deposit',
      productDescription: `Deposit for appointment on ${formatDateInOrgZone(orgTimeZone, existingAppointment.startDate)}`,
      taxCode: service?.taxCode ?? null,
      successUrl,
      cancelUrl,
      expiresAt,
      // Deterministic key off the appointment + amount so a retried request
      // can't open a second checkout session for the same deposit.
      idempotencyKey: `deposit-checkout:${appointmentId}:${amountCents}`,
      metadata: {
        appointmentId,
        organizationId,
      },
    });

    // Create deposit record
    const [deposit] = await db
      .insert(appointmentDeposit)
      .values({
        appointmentId,
        organizationId,
        amountCents,
        currency,
        status: 'pending',
        stripeCheckoutSessionId: checkoutResult.sessionId,
        stripeConnectedAccountId: integration.stripeAccountId,
        checkoutUrl: checkoutResult.url,
        expiresAt,
      })
      .returning();

    // The slot is now HELD, not booked: it is reserved but unpaid, and the
    // clock is mirrored onto the appointment so `expireAppointmentHolds` sees
    // it too. `expireAppointmentDeposit` still settles the deposit row itself;
    // whichever expiry path fires first, the other becomes a no-op.
    //
    // Only a booking that has not already progressed (arrived/started/etc.)
    // becomes a hold — a staff member marking someone arrived must not be
    // walked back by a deposit request.
    await db
      .update(appointment)
      .set({
        depositRequired: true,
        status: 'held',
        holdExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointment.id, appointmentId),
          inArray(appointment.status, ['booked', 'held']),
          notDeleted(appointment)
        )
      );

    return ok({
      deposit,
      checkoutUrl: checkoutResult.url,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'StripeTaxSetupIncompleteError'
    ) {
      return err(new FeatureError(ErrorCodes.INVALID_STATE, error.message));
    }

    logError('appointments.createDepositRequest', error, {
      feature: 'appointments',
      extra: { appointmentId, organizationId, amountCents },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create deposit request'
      )
    );
  }
};

/**
 * Create a deposit request for an appointment
 */
export const createDepositRequest = (
  db: DbConnection,
  input: CreateDepositRequestInput
) =>
  trackedResult(
    'appointments.createDepositRequest',
    () => withOrgScope((tx) => createDepositRequestImpl(tx, input), { db }),
    {
      properties: {
        appointmentId: input.appointmentId,
        organizationId: input.organizationId,
      },
    }
  );

export type CreateDepositRequestResult = Awaited<
  ReturnType<typeof createDepositRequest>
>;
