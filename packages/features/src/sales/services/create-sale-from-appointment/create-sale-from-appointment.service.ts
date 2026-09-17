import {
  appointment,
  appointmentService,
  sale,
  saleItem,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  currencyForCountry,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { SaleWithRelations } from '../../models/sale.types.js';
import {
  loadSaleWithRelations,
  recomputeAndPersistTotals,
} from '../../utils/load-sale.js';
import {
  type CreateSaleFromAppointmentInput,
  createSaleFromAppointmentSchema,
} from './create-sale-from-appointment.schema.js';

/**
 * Seed a POS sale from an existing appointment. Unlike a walk-in sale, this
 * pulls the *authoritative* data from the appointment — its client and the
 * price snapshots stored on each `appointment_service` line — instead of
 * trusting the operator to key them in.
 *
 * The appointment is added as a single `appointment` line (the shape
 * checkout-flow relies on for the deposit credit + status menu) priced at the
 * sum of the booked services' snapshot prices, and the sale is bound to the
 * appointment's client so the checkout opens with them pre-filled.
 *
 * Any deposit already paid online is credited as a `deposit` tender, so the
 * checkout opens showing the balance due rather than the full price.
 */
const createSaleFromAppointmentImpl = async (
  db: DbConnection,
  input: CreateSaleFromAppointmentInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = createSaleFromAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, createdById, appointmentId } = parsed.data;

  try {
    const result = await withOrgScope(
      async (tx) => {
        const appt = await tx.query.appointment.findFirst({
          where: and(
            eq(appointment.id, appointmentId),
            eq(appointment.organizationId, organizationId),
            notDeleted(appointment)
          ),
          columns: { id: true, leadId: true, locationId: true, title: true },
        });
        if (!appt) {
          return {
            error: new FeatureError(
              ErrorCodes.NOT_FOUND,
              'Appointment not found'
            ),
          };
        }

        const services = await tx.query.appointmentService.findMany({
          where: eq(appointmentService.appointmentId, appointmentId),
          orderBy: [asc(appointmentService.sortOrder)],
          columns: { name: true, priceCents: true, serviceId: true },
        });

        // Currency comes from the org's primary location country
        // (there is NO org currency setting).
        const primaryLocation = await tx.query.organizationLocation.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(
              eqOp(t.organizationId, organizationId),
              eqOp(t.isPrimary, true)
            ),
        });
        const currency = currencyForCountry(
          primaryLocation?.country ?? null
        ).code.toLowerCase();

        const [created] = await tx
          .insert(sale)
          .values({
            organizationId,
            createdById,
            leadId: appt.leadId ?? null,
            // The branch the APPOINTMENT was booked at — not the till the
            // operator happens to be standing at, and not the org default.
            // Without this the sale was written unbranded on every
            // calendar-originated checkout, which in a salon is most of the
            // revenue: invisible in that branch's sales list and takings, and
            // `completeSale` gates the stock decrement on this column, so the
            // products sold were never taken off stock. A backfill cannot fix
            // it, because it keeps happening.
            locationId: appt.locationId ?? null,
            status: 'open',
            currency,
          })
          .returning();

        // Snapshot price = sum of the booked services' stored prices. A service
        // with no snapshot price (from/poa/free) contributes 0, leaving the
        // operator to set it in the cart — same as picking that service by hand.
        const unitPriceCents = services.reduce(
          (sum, s) => sum + (s.priceCents ?? 0),
          0
        );
        const lineName =
          services.map((s) => s.name).join(', ') || appt.title || 'Appointment';

        await tx.insert(saleItem).values({
          saleId: created.id,
          itemType: 'appointment',
          appointmentId,
          name: lineName,
          quantity: 1,
          unitPriceCents,
          totalCents: unitPriceCents,
        });

        // Credit any deposit the customer already paid online. Modelled as a
        // TENDER, not a discount: the subtotal stays the true price of the work,
        // and `completeSale`'s existing `sum(succeeded tenders) >= totalCents`
        // rule then computes the correct balance due with no further changes.
        //
        // Without this the customer pays twice — the deposit reaches Stripe and
        // the POS still asks for the full amount.
        const paidDeposits = await tx.query.appointmentDeposit.findMany({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(
              eqOp(t.appointmentId, appointmentId),
              eqOp(t.organizationId, organizationId),
              eqOp(t.status, 'paid')
            ),
          columns: { id: true, amountCents: true, currency: true },
        });

        // Drop the ones an earlier sale for this appointment already spent. The
        // unique index is the real guard; this just avoids a write we know would
        // fail. Both sets are tiny (one deposit in almost every case).
        const alreadySpent = paidDeposits.length
          ? await tx.query.salePayment.findMany({
              where: (t, { inArray: inArrayOp }) =>
                inArrayOp(
                  t.appointmentDepositId,
                  paidDeposits.map((d) => d.id)
                ),
              columns: { appointmentDepositId: true },
            })
          : [];
        const spentIds = new Set(
          alreadySpent.map((p) => p.appointmentDepositId)
        );

        for (const deposit of paidDeposits) {
          if (spentIds.has(deposit.id)) continue;

          // A deposit taken in one currency cannot pay down a sale denominated
          // in another — crediting it would silently invent an exchange rate.
          // Rare (both derive from the same org) but wrong enough to refuse.
          if (deposit.currency.toLowerCase() !== currency) {
            logError(
              'sales.createSaleFromAppointment.depositCurrencyMismatch',
              new Error(
                `Paid deposit in ${deposit.currency} not credited to a ${currency} sale`
              ),
              {
                feature: 'sales',
                extra: {
                  organizationId,
                  appointmentId,
                  depositId: deposit.id,
                  depositCurrency: deposit.currency,
                  saleCurrency: currency,
                },
              }
            );
            continue;
          }

          await tx.insert(salePayment).values({
            saleId: created.id,
            method: 'deposit',
            amountCents: deposit.amountCents,
            // Already settled with Stripe at booking time — there is nothing
            // left to capture, so it is `succeeded` on arrival.
            status: 'succeeded',
            appointmentDepositId: deposit.id,
          });
        }

        const existing = await loadSaleWithRelations(
          tx,
          organizationId,
          created.id
        );
        if (!existing) {
          return {
            error: new FeatureError(
              ErrorCodes.INTERNAL_ERROR,
              'Failed to load the newly created sale'
            ),
          };
        }
        const updated = await recomputeAndPersistTotals(tx, existing);
        return { updated };
      },
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as SaleWithRelations);
  } catch (error) {
    logError('sales.createSaleFromAppointment', error, {
      feature: 'sales',
      extra: { organizationId, appointmentId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create sale from appointment'
      )
    );
  }
};

export const createSaleFromAppointment = (
  db: DbConnection,
  input: CreateSaleFromAppointmentInput
) =>
  trackedResult(
    'sales.createSaleFromAppointment',
    () => createSaleFromAppointmentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
      },
    }
  );

export type CreateSaleFromAppointmentResult = Awaited<
  ReturnType<typeof createSaleFromAppointment>
>;
