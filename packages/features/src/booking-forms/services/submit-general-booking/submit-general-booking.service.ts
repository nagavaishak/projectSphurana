import {
  appointment,
  appointmentService,
  calendarAccount,
  lead,
  member,
  organization,
  organizationService,
  organizationServiceVariant,
  practitioner,
  practitionerLocation,
  practitionerService,
} from '@borradh-workspace/database';
import { withPublicOrgScope } from '@borradh-workspace/database';
import { BookingConfirmationEmail, sendEmail } from '@borradh-workspace/email';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { resolveAppointmentDuration } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  buildManageBookingUrl,
  issueManageToken,
} from '../../../appointments/index.js';
import { createDepositRequest } from '../../../appointments/services/create-deposit-request/create-deposit-request.service.js';
import { notifyOwnerBooking } from '../../../appointments/services/notify-owner-booking/notify-owner-booking.service.js';
import { notifyPractitionerBooking } from '../../../appointments/services/notify-practitioner-booking/notify-practitioner-booking.service.js';
import { createSubmissionsForAppointment } from '../../../consent-forms/index.js';
import { attachLeadAttribution } from '../../../microsites/index.js';
import { sendPushNotification } from '../../../notifications/services/send-push-notification/send-push-notification.service.js';
import {
  formatBookingLocationAddress,
  resolveBookingLocation,
} from '../../../organization-locations/index.js';
import { buildPortalHomeUrl } from '../../../patient-auth/index.js';
import { resolveAvailability } from '../../../scheduling/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  currencyForCountry,
  customerBookablePractitioner,
  err,
  isCustomerBookable,
  isExclusionViolation,
  notDeleted,
  ok,
  resolveMicrositeLinkTarget,
} from '../../../shared/index.js';
import type { GeneralBookingResult } from '../../models/index.js';
import {
  toBookingPaymentDefaults,
  toBookingPaymentService,
} from '../../shared/booking-payment-adapters.js';
import {
  type ResolvedBookingPayment,
  resolveBookingPayment,
} from '../../shared/resolve-booking-payment.js';
import {
  type SubmitGeneralBookingInput,
  submitGeneralBookingSchema,
} from './submit-general-booking.schema.js';

/**
 * Check if a practitioner is available for the given time slot.
 *
 * This is the WRITE-side gate, and it must agree with what the booking page
 * offered — so it asks the same resolver the slots endpoint does rather than
 * re-deriving availability. Checking only for an overlapping appointment (what
 * this used to do) accepts any time a caller posts: a day the practitioner
 * marked as not working, a time-off block, or an out-of-hours slot the page
 * never showed all sailed through.
 */
async function isPractitionerAvailable(
  db: DbConnection,
  practitionerId: string,
  organizationId: string,
  timeZone: string,
  startTime: Date,
  endTime: Date,
  locationId?: string
): Promise<boolean> {
  const [avail] = await resolveAvailability(db, {
    organizationId,
    practitionerIds: [practitionerId],
    from: startTime,
    to: endTime,
    timeZone,
    // The branch being booked. The resolver drops shifts belonging to another
    // branch, so somebody rostered only at Cork stops counting as available in
    // Dublin — the same argument the slots endpoint now passes, because the
    // write gate has to agree with what the page offered.
    locationId,
  });

  if (!avail) return false;

  // On shift for the whole requested span…
  const onShift = avail.working.some(
    (w) => w.start <= startTime && w.end >= endTime
  );
  if (!onShift) return false;

  // …and nothing (time off, blocked time, an existing appointment) overlaps it.
  return !avail.busy.some((b) => startTime < b.end && endTime > b.start);
}

/**
 * Find the first available practitioner for a service in the given time slot.
 *
 * Mirrors the read path: a service with no practitioner links falls back to the
 * org's active practitioners, so the person the slots endpoint drew the times
 * from is the person the appointment gets pinned to.
 *
 * Returns null when nobody is free, which the caller turns into a refusal. An
 * org with no practitioners at all lands here too, and that is correct: the
 * slots endpoint offers it nothing either, because availability is expressed
 * only through a practitioner's shifts.
 */
async function findFirstAvailablePractitioner(
  db: DbConnection,
  serviceId: string,
  orgId: string,
  timeZone: string,
  startTime: Date,
  endTime: Date,
  locationId?: string
): Promise<typeof practitioner.$inferSelect | null> {
  // Branch-scoped exactly as the slots read path is: "assigned to this branch,
  // or to no branch at all". Without it the write path would happily pin a
  // Cork-only practitioner to a Dublin booking that the page never offered.
  const atThisBranch = (entityId: PgColumn) =>
    locationId
      ? [
          atLocationOrUnassigned(
            db,
            practitionerLocation,
            practitionerLocation.practitionerId,
            entityId,
            practitionerLocation.locationId,
            locationId
          ),
        ]
      : [];

  const serviceLinks = await db.query.practitionerService.findMany({
    where: and(
      eq(practitionerService.serviceId, serviceId),
      ...atThisBranch(practitionerService.practitionerId)
    ),
    with: {
      practitioner: true,
    },
  });

  let candidates = serviceLinks
    .map((link) => link.practitioner)
    .filter((p) => p.organizationId === orgId && isCustomerBookable(p));

  if (candidates.length === 0) {
    candidates = await db.query.practitioner.findMany({
      where: and(
        eq(practitioner.organizationId, orgId),
        customerBookablePractitioner(),
        ...atThisBranch(practitioner.id)
      ),
    });
  }

  for (const candidate of candidates) {
    const available = await isPractitionerAvailable(
      db,
      candidate.id,
      orgId,
      timeZone,
      startTime,
      endTime,
      locationId
    );
    if (available) {
      return candidate;
    }
  }

  return null;
}

/**
 * Format the booked slot for the CLIENT's confirmation email, in the BUSINESS's
 * timezone.
 *
 * `timeZone` is REQUIRED. Without it these fall back to the SERVER's zone — UTC
 * on Fly — so a client booking 2pm at a Dublin clinic was emailed "01:00 PM".
 * See send-reminders.service.ts for the full history.
 */
function formatAppointmentDate(
  date: Date,
  timeZone: string
): {
  formattedDate: string;
  formattedTime: string;
} {
  const formattedDate = date.toLocaleDateString('en-IE', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-IE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return { formattedDate, formattedTime };
}

const submitGeneralBookingImpl = async (
  db: DbConnection,
  input: SubmitGeneralBookingInput
): Promise<Result<GeneralBookingResult>> => {
  const parsed = submitGeneralBookingSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationSlug,
    locationSlug,
    serviceId,
    serviceIds,
    serviceItems,
    firstName,
    lastName,
    email,
    phone,
    notes,
    appointmentStartTime,
    appointmentEndTime,
    practitionerId: requestedPractitionerId,
    bookingPageUrl,
    micrositeId,
    landingUrl,
  } = parsed.data;

  // Validate times
  if (appointmentEndTime <= appointmentStartTime) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'End time must be after start time'
      )
    );
  }

  if (appointmentStartTime < new Date()) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Cannot book appointments in the past'
      )
    );
  }

  // ── Slug bootstrap (runs OUTSIDE withPublicOrgScope) ──────────────────────
  // Resolve slug → org_id before org context is established. The slug_bootstrap
  // policy on `organization` permits app_public to SELECT a non-mock org row by
  // slug with no app.current_org_id set. This MUST be outside withPublicOrgScope
  // (chicken-and-egg: we need the org id to call withPublicOrgScope).
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // ── Scoped reads + writes (runs INSIDE withPublicOrgScope) ────────────────
  // All subsequent queries run with app.current_org_id = org.id set in the
  // transaction. The org_isolation RLS policy enforces this at the DB level:
  //
  //   READ isolation: every SELECT is implicitly filtered to org.id rows only.
  //   WRITE safety: org_isolation WITH CHECK (organization_id = …) means a
  //     tampered organizationId in the submitted payload CANNOT write into
  //     another org's appointments or leads. The DB rejects it regardless of
  //     what arrives in the request body. No extra application-layer check is
  //     needed for this invariant.
  //
  // withPublicOrgScope opens a short SET LOCAL transaction (RLS flag ON) or
  // passes through with no transaction (RLS flag OFF). Either way the function
  // signature and behaviour are identical from the caller's perspective.
  //
  // IMPORTANT (wave-1 lesson): ALWAYS pass { db } so we use the injected
  // connection — the app_public pool wired in Phase 2 / I3, or the test mock.
  // Omitting { db } falls back to the global default db pool, breaking pool
  // separation and test isolation.
  //
  // TRANSACTION NESTING: withPublicOrgScope wraps the outer scope; the inner
  // tx.transaction() call handles the atomic lead+appointment INSERT pair via
  // a Postgres savepoint. This is safe and preserves both RLS scoping AND
  // atomicity.
  // Computed inside the scoped closure (where the service rows are in scope) and
  // read afterwards to drive the deposit-checkout step. 0 → no deposit required.
  // The `reason` rides along so the confirmation screen can name the charge —
  // a `full` prepay must not be announced as a deposit.
  let computedPayment: ResolvedBookingPayment = {
    amountCents: 0,
    reason: 'none',
  };
  // Same pattern, for the consent-form step that runs after the booking commits
  // (see the call below `bookingResult`).
  let bookedServiceId: string | null = null;
  // The primary service's display fields, captured inside the scope so the
  // confirmation email (sent AFTER the commit, so it can mint a portal magic
  // link on a fresh connection) can read them without re-querying.
  let bookedServiceName: string | null = null;
  let bookedServiceDuration = 30;
  // Same pattern again: the RESOLVED branch's postal address, captured inside
  // the scope so the confirmation email — sent after the commit — can name the
  // branch the customer is actually going to. `null` when the org has no
  // branches at all, or the branch has no address on file; the template then
  // omits the location line rather than printing another branch's address.
  let bookedLocationAddress: string | null = null;

  const bookingResult = await withPublicOrgScope(
    org.id,
    async (tx) => {
      // Find the service — org_isolation policy ensures it belongs to this org
      const service = await tx.query.organizationService.findFirst({
        where: and(
          eq(organizationService.id, serviceId),
          eq(organizationService.organizationId, org.id),
          eq(organizationService.isActive, true)
        ),
      });

      if (!service) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found')
        ) as Result<GeneralBookingResult>;
      }

      // ── Multi-service cart ──────────────────────────────────────────────────
      // Snapshot each service in `serviceIds` into a line item (name/duration/
      // price copied at booking time) and extend the appointment to the summed
      // duration. Reads are org-scoped (org_isolation RLS + explicit org filter).
      // The single `serviceId` above stays the appointment's primary service.
      let cartLineItems: Array<{
        serviceId: string;
        name: string;
        durationMinutes: number;
        priceCents: number | null;
        sortOrder: number;
      }> = [];
      let effectiveEndTime = appointmentEndTime;

      // The full DB rows for every distinct service in the cart — hoisted so the
      // deposit computation below can read each service's per-service deposit
      // config (`requiresDeposit` / `depositAmountCents`) after cart resolution.
      let cartServices: (typeof organizationService.$inferSelect)[] = [];

      // Normalise the cart to a list of { serviceId, variantId? }. `serviceItems`
      // (which may carry a chosen variant per service) wins; otherwise the plain
      // `serviceIds` list is mapped to variant-less selections (back-compat).
      const cartSelections: { serviceId: string; variantId?: string }[] =
        serviceItems && serviceItems.length > 0
          ? serviceItems
          : (serviceIds ?? []).map((id) => ({ serviceId: id }));

      if (cartSelections.length > 0) {
        const cartServiceIds = [
          ...new Set(cartSelections.map((s) => s.serviceId)),
        ];
        cartServices = await tx.query.organizationService.findMany({
          where: and(
            inArray(organizationService.id, cartServiceIds),
            eq(organizationService.organizationId, org.id),
            eq(organizationService.isActive, true)
          ),
        });
        const byId = new Map(cartServices.map((svc) => [svc.id, svc]));

        // Resolve the chosen variants. Each must belong to one of the cart's
        // services AND be active — a tampered/foreign variantId simply resolves
        // to undefined and the line falls back to the service-level price.
        const variantIds = cartSelections
          .map((s) => s.variantId)
          .filter((id): id is string => id !== undefined);
        const variantRows =
          variantIds.length > 0
            ? await tx.query.organizationServiceVariant.findMany({
                where: and(
                  inArray(organizationServiceVariant.id, variantIds),
                  inArray(organizationServiceVariant.serviceId, cartServiceIds),
                  eq(organizationServiceVariant.isActive, true)
                ),
              })
            : [];
        const variantById = new Map(variantRows.map((v) => [v.id, v]));

        // Preserve the customer's chosen order; drop selections whose service
        // didn't resolve. Snapshot the VARIANT's price/duration/name when one is
        // chosen (falling back to the service), never a client-sent price.
        cartLineItems = cartSelections
          .map((sel) => {
            const svc = byId.get(sel.serviceId);
            return svc
              ? { svc, variantId: sel.variantId }
              : (null as {
                  svc: (typeof cartServices)[number];
                  variantId?: string;
                } | null);
          })
          .filter(
            (
              e
            ): e is {
              svc: (typeof cartServices)[number];
              variantId?: string;
            } => e !== null
          )
          .map(({ svc, variantId }, index) => {
            const variant = variantId ? variantById.get(variantId) : undefined;
            const priceCents = variant
              ? (variant.priceCents ?? svc.priceCents ?? null)
              : (svc.priceCents ?? null);
            // A variant states its own length; otherwise the service resolves
            // through the one canonical ladder (ENG-793). The old `?? 0` meant
            // a cart of null-duration services summed to zero and silently fell
            // back to whatever end time the client had sent.
            const durationMinutes =
              variant?.durationMinutes ??
              resolveAppointmentDuration(
                svc.appointmentDuration,
                org.defaultAppointmentDuration
              );
            const name = variant ? `${svc.name} — ${variant.name}` : svc.name;
            return {
              serviceId: svc.id,
              name,
              durationMinutes,
              priceCents,
              sortOrder: index,
            };
          });

        const totalMinutes = cartLineItems.reduce(
          (sum, item) => sum + item.durationMinutes,
          0
        );
        if (totalMinutes > 0) {
          effectiveEndTime = new Date(
            appointmentStartTime.getTime() + totalMinutes * 60_000
          );
        }
      }

      // ── What is due online ─────────────────────────────────────────────────
      // Delegated to `resolveBookingPayment`, the ONE place this question is
      // answered — Claire's quoting and the public booking config read the same
      // function, so a quote can no longer disagree with the charge.
      //
      // Computed here, inside the scoped closure, because that's where the
      // service rows are; consumed after the booking commits, because the Stripe
      // round-trip must run outside the RLS transaction.
      //
      // The single-service path (`serviceId` with no cart) uses the primary
      // `service` row.
      bookedServiceId = service.id;
      bookedServiceName = service.name;
      bookedServiceDuration = resolveAppointmentDuration(
        service.appointmentDuration,
        org.defaultAppointmentDuration
      );
      const bookedServices = cartServices.length > 0 ? cartServices : [service];
      computedPayment = resolveBookingPayment(
        bookedServices.map(toBookingPaymentService),
        toBookingPaymentDefaults(org)
      );

      // ── Which branch this booking is FOR ──────────────────────────────────
      // The slug the customer's URL carried, else the org's DEFAULT branch
      // (the pre-branch behaviour). Resolved HERE, before practitioner
      // assignment, because assignment and the availability check are both
      // branch-scoped now — this used to be resolved just before the INSERT
      // and only ever produced the default, so a booking made on Cork's page
      // was stamped with Dublin.
      const bookedLocation = await resolveBookingLocation(
        tx,
        org.id,
        locationSlug
      );
      if (locationSlug && !bookedLocation) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
        ) as Result<GeneralBookingResult>;
      }
      const bookedLocationId = bookedLocation?.id ?? null;
      bookedLocationAddress = formatBookingLocationAddress(bookedLocation);

      // Resolve practitioner assignment
      let assignedPractitioner: typeof practitioner.$inferSelect | null = null;

      if (requestedPractitionerId) {
        const prac = await tx.query.practitioner.findFirst({
          where: and(
            eq(practitioner.id, requestedPractitionerId),
            eq(practitioner.organizationId, org.id),
            customerBookablePractitioner(),
            // A practitioner who does not work at this branch is not bookable
            // at it, the same way the slots endpoint no longer offers them.
            ...(bookedLocationId
              ? [
                  atLocationOrUnassigned(
                    tx,
                    practitionerLocation,
                    practitionerLocation.practitionerId,
                    practitioner.id,
                    practitionerLocation.locationId,
                    bookedLocationId
                  ),
                ]
              : [])
          ),
        });

        if (!prac) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
          ) as Result<GeneralBookingResult>;
        }

        const available = await isPractitionerAvailable(
          tx,
          prac.id,
          org.id,
          org.timezone || 'UTC',
          appointmentStartTime,
          effectiveEndTime,
          bookedLocationId ?? undefined
        );

        if (!available) {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'The selected practitioner is not available at this time'
            )
          ) as Result<GeneralBookingResult>;
        }

        assignedPractitioner = prac;
      } else {
        assignedPractitioner = await findFirstAvailablePractitioner(
          tx,
          serviceId,
          org.id,
          org.timezone || 'UTC',
          appointmentStartTime,
          effectiveEndTime,
          bookedLocationId ?? undefined
        );

        // Every appointment is pinned to a practitioner. A null one cannot be
        // subtracted from anyone's availability, so the time would be offered
        // again — and nobody is rostered to do the work.
        if (!assignedPractitioner) {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'That time is no longer available — please pick another'
            )
          ) as Result<GeneralBookingResult>;
        }
      }

      // Find default assignee (member table — SELECT granted to app_public)
      const defaultAssignee = await tx.query.member.findFirst({
        where: and(eq(member.organizationId, org.id), eq(member.role, 'owner')),
      });

      const assignee =
        defaultAssignee ||
        (await tx.query.member.findFirst({
          where: eq(member.organizationId, org.id),
        }));

      if (!assignee) {
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'No team member found to assign appointment'
          )
        ) as Result<GeneralBookingResult>;
      }

      // Atomic INSERT: lead + appointment in a nested transaction (savepoint).
      // org_isolation WITH CHECK ensures organization_id = org.id at DB level.
      //
      // The appointment_no_overlap exclusion constraint is the concurrency
      // backstop: if a competing online booking commits the same practitioner +
      // overlapping slot between our availability check above and this INSERT,
      // the constraint rejects our INSERT (SQLSTATE 23P01). We surface that as a
      // clean CONFLICT instead of a 500 — the slot was taken out from under us.
      let result: {
        leadId: string;
        appointmentId: string;
        appointmentStartTime: Date;
        appointmentEndTime: Date;
      };
      try {
        result = await tx.transaction(async (innerTx) => {
          // 1. Create or find existing lead
          let leadRecord: typeof lead.$inferSelect | undefined;

          if (email) {
            leadRecord = await innerTx.query.lead.findFirst({
              where: and(
                eq(lead.organizationId, org.id),
                eq(lead.email, email),
                notDeleted(lead)
              ),
            });
          }

          if (!leadRecord) {
            const [newLead] = await innerTx
              .insert(lead)
              .values({
                organizationId: org.id,
                firstName,
                lastName: lastName || null,
                email: email || null,
                phone: phone || null,
                source: 'website',
                status: 'booked',
                // They booked with us themselves — contactable by default.
                consentEmail: true,
                consentSms: true,
                consentVoice: true,
                consentSource: 'booking_form',
                consentedAt: new Date(),
              })
              .returning();
            leadRecord = newLead;
          } else {
            await innerTx
              .update(lead)
              .set({ status: 'booked' })
              .where(and(eq(lead.id, leadRecord.id), notDeleted(lead)));
          }

          // 2. Create appointment
          const appointmentTitle =
            `${service.name}: ${firstName} ${lastName || ''}`.trim();

          const [newAppointment] = await innerTx
            .insert(appointment)
            .values({
              title: appointmentTitle,
              description: notes
                ? `Notes: ${notes}\n\nBooked via general booking page`
                : 'Booked via general booking page',
              startDate: appointmentStartTime,
              endDate: effectiveEndTime,
              status: 'booked',
              source: 'booking_form',
              leadId: leadRecord.id,
              serviceId: service.id,
              assignedToId: assignee.userId,
              organizationId: org.id,
              // The branch this booking belongs to. REQUIRED once the calendar
              // filters by branch: an appointment with a NULL location does not
              // appear on ANY branch's diary, so a public booking would land in
              // the database and nowhere a human looks. The general form has no
              // branch in its URL, so it is the default branch's form — the
              // same resolution `getGeneralBookingConfig` priced against.
              locationId: bookedLocationId,
              practitionerId: assignedPractitioner?.id ?? null,
            })
            .returning();

          // Persist the cart line items in the same atomic transaction as the
          // appointment. Each line inherits the appointment's practitioner.
          if (cartLineItems.length > 0) {
            await innerTx.insert(appointmentService).values(
              cartLineItems.map((item) => ({
                appointmentId: newAppointment.id,
                serviceId: item.serviceId,
                name: item.name,
                durationMinutes: item.durationMinutes,
                priceCents: item.priceCents,
                practitionerId: assignedPractitioner?.id ?? null,
                sortOrder: item.sortOrder,
              }))
            );
          }

          return {
            leadId: leadRecord.id,
            appointmentId: newAppointment.id,
            appointmentStartTime,
            appointmentEndTime: effectiveEndTime,
          };
        });
      } catch (error) {
        // DELIBERATELY not `isDeadlock` here, unlike the two resource-hold
        // writers, which do treat 40P01 as a lost race. Those each lock one row
        // and write one table, so a cycle can only mean another writer took the
        // same room. This transaction upserts a lead, inserts the appointment
        // and inserts its services, so a deadlock is not evidence about the
        // overlap in particular — reporting it as "that time slot was just
        // booked" would be a guess, and would tell someone to pick another time
        // when the time was never the problem. It stays an INTERNAL_ERROR until
        // there is a reason to believe otherwise.
        if (isExclusionViolation(error, 'appointment_no_overlap')) {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'That time slot was just booked. Please choose another time.'
            )
          ) as Result<GeneralBookingResult>;
        }
        throw error;
      }

      // Calendar sync (fire-and-forget, runs on the scoped tx connection)
      const calendarAccountIdToSync =
        assignedPractitioner?.calendarAccountId ?? org.primaryCalendarAccountId;

      if (
        calendarAccountIdToSync &&
        (assignedPractitioner?.calendarAccountId ||
          org.primaryCalendarType === 'google_calendar')
      ) {
        try {
          const calAccount = await tx.query.calendarAccount.findFirst({
            where: eq(calendarAccount.id, calendarAccountIdToSync),
          });

          if (calAccount?.isActive) {
            const credentials = decryptCredentials<{
              accessToken: string;
              refreshToken?: string;
            }>(calAccount.encryptedCredentials);

            let accessToken = credentials.accessToken;

            if (
              calAccount.tokenExpiresAt &&
              new Date() >= calAccount.tokenExpiresAt &&
              credentials.refreshToken
            ) {
              const oauthService = new GoogleCalendarOAuthService();
              const newTokens = await oauthService.refreshAccessToken(
                credentials.refreshToken
              );
              accessToken = newTokens.accessToken;

              await tx
                .update(calendarAccount)
                .set({
                  encryptedCredentials: encryptCredentials({
                    accessToken: newTokens.accessToken,
                    refreshToken:
                      newTokens.refreshToken ?? credentials.refreshToken,
                    expiresIn: newTokens.expiresIn,
                  }),
                  tokenExpiresAt: new Date(
                    Date.now() + newTokens.expiresIn * 1000
                  ),
                })
                .where(eq(calendarAccount.id, calendarAccountIdToSync));
            }

            const calendarService = new GoogleCalendarService(accessToken);
            const calendarEvent = await calendarService.createEvent(
              calAccount.calendarId,
              {
                summary:
                  `${service.name}: ${firstName} ${lastName || ''}`.trim(),
                description: [
                  `Customer: ${firstName} ${lastName || ''}`.trim(),
                  email ? `Email: ${email}` : '',
                  phone ? `Phone: ${phone}` : '',
                  `Service: ${service.name}`,
                  assignedPractitioner
                    ? `Practitioner: ${assignedPractitioner.name}`
                    : '',
                  notes ? `Notes: ${notes}` : '',
                  '',
                  'Booked via general booking page',
                ]
                  .filter(Boolean)
                  .join('\n'),
                start: {
                  dateTime: appointmentStartTime.toISOString(),
                  timeZone: 'UTC',
                },
                end: {
                  dateTime: effectiveEndTime.toISOString(),
                  timeZone: 'UTC',
                },
                attendees: email
                  ? [
                      {
                        email,
                        displayName: `${firstName} ${lastName || ''}`.trim(),
                      },
                    ]
                  : undefined,
              }
            );

            await tx
              .update(appointment)
              .set({
                calendarAccountId: calAccount.id,
                externalCalendarEventId: calendarEvent.id,
              })
              .where(
                and(
                  eq(appointment.id, result.appointmentId),
                  notDeleted(appointment)
                )
              );
          }
        } catch (error) {
          logError('bookingForms.submitGeneralBooking.calendarSync', error, {
            feature: 'booking-forms',
            extra: {
              appointmentId: result.appointmentId,
              organizationId: org.id,
              practitionerId: assignedPractitioner?.id,
            },
          });
        }
      }

      // Fire-and-forget practitioner notification (email + push).
      // These fire on the plain db (not the scoped tx) because they are
      // cross-feature calls that open their own connections/scopes.
      if (assignedPractitioner) {
        notifyPractitionerBooking(db, {
          appointmentId: result.appointmentId,
          organizationId: org.id,
        }).catch((error) =>
          logError(
            'bookingForms.submitGeneralBooking.notifyPractitioner',
            error,
            {
              feature: 'booking-forms',
              extra: {
                appointmentId: result.appointmentId,
                practitionerId: assignedPractitioner?.id,
              },
            }
          )
        );

        // Push notification to practitioner (if linked to a user account)
        if (assignedPractitioner.userId) {
          sendPushNotification(db, {
            userId: assignedPractitioner.userId,
            title: 'New Booking',
            body: `${firstName} booked ${service.name}`,
            data: {
              screen: 'appointments',
              appointmentId: result.appointmentId,
            },
          }).catch((error) =>
            logError(
              'bookingForms.submitGeneralBooking.pushPractitioner',
              error,
              {
                feature: 'booking-forms',
                extra: {
                  appointmentId: result.appointmentId,
                  practitionerId: assignedPractitioner?.id,
                },
              }
            )
          );
        }
      }

      // Fire-and-forget owner notification (email + push)
      notifyOwnerBooking(db, {
        appointmentId: result.appointmentId,
        organizationId: org.id,
      }).catch((error) =>
        logError('bookingForms.submitGeneralBooking.notifyOwner', error, {
          feature: 'booking-forms',
          extra: {
            appointmentId: result.appointmentId,
            organizationId: org.id,
          },
        })
      );

      // Push notification to organization owner (skip if same user as practitioner)
      const ownerAlreadyNotified =
        assignedPractitioner?.userId &&
        assignee?.userId === assignedPractitioner.userId;

      if (assignee?.userId && !ownerAlreadyNotified) {
        sendPushNotification(db, {
          userId: assignee.userId,
          title: 'New Booking',
          body: `${firstName} booked ${service.name}`,
          data: {
            screen: 'appointments',
            appointmentId: result.appointmentId,
          },
        }).catch((error) =>
          logError('bookingForms.submitGeneralBooking.pushOwner', error, {
            feature: 'booking-forms',
            extra: {
              appointmentId: result.appointmentId,
              organizationId: org.id,
            },
          })
        );
      }

      // NOTE: the confirmation email is sent AFTER this scope commits (see the
      // block below `bookingResult`). It issues an appointment-scoped manage
      // token for the "Manage your booking" button, and `issueManageToken`
      // writes a row carrying an FK to this appointment — so it must run once
      // the booking is durable.

      return ok(result) as Result<GeneralBookingResult>;
    },
    { db }
  );

  if (!bookingResult.success) {
    return bookingResult;
  }

  // ── Microsite attribution — runs AFTER the booking commits ───────────────
  // The lead this booking created is the CAC join key: without `micrositeId`
  // and the UTMs on the row, `computeCampaignCac` has nothing to join spend
  // against and reports zero attributed leads forever.
  //
  // FIRE-AND-FORGET, and deliberately so. The booking is already durable and
  // the customer is already looking at their confirmation; an attribution write
  // that fails is a reporting gap, never a failed booking. It is also OUTSIDE
  // the scoped transaction for the same reason as the consent-form and deposit
  // steps below — its own scope, on its own connection, against a committed row.
  //
  // Skipped entirely when the browser sent neither field, so a direct booking
  // does exactly what it did before this existed.
  if (micrositeId || landingUrl) {
    void attachLeadAttribution(db, {
      organizationId: org.id,
      leadId: bookingResult.data.leadId,
      micrositeId,
      landingUrl,
    }).catch((error) =>
      logError('bookingForms.submitGeneralBooking.attribution', error, {
        feature: 'booking-forms',
        extra: { leadId: bookingResult.data.leadId, micrositeId },
      })
    );
  }

  // ── Confirmation email (ENG-647) — runs AFTER the booking commits ─────────
  // Sent here, out of the scope, because the "Manage your booking" token
  // carries an FK to the appointment and can only be written once the booking
  // is durable. Kept BEFORE the consent trigger below so the confirmation is
  // initiated first (the consent request reads as the follow-up to it).
  if (email && bookedServiceName) {
    // Formatted in the BUSINESS's timezone, not the server's. This call moved
    // out of the transaction on this branch while main was making the timezone
    // argument required — without it a 2pm Dublin booking emails as "01:00 PM".
    const { formattedDate, formattedTime } = formatAppointmentDate(
      appointmentStartTime,
      org.timezone || 'UTC'
    );

    // The "Manage your booking" CTA is an APPOINTMENT-SCOPED capability, not a
    // portal sign-in.
    //
    // This email is sent at booking time, sometimes weeks ahead, and email is
    // a channel we do not control: it gets forwarded, sits in shared family
    // mailboxes, and lives in the recipient's backups. A credential riding in
    // it should be worth exactly what the email is ABOUT — this one booking.
    // A portal magic link instead hands whoever opens the message the entire
    // record (documents, signed consent forms, every past and future
    // appointment), and no sane link TTL fits an email that may be read a
    // month after it was sent.
    //
    // Reminders are different — they go out 24h and 1h ahead, so a short-lived
    // portal link is appropriate there. See send-appointment-reminder.
    //
    // If minting fails the email still goes out; the button falls back to the
    // portal home, where the patient signs in with a code.
    // One host lookup for BOTH links in this email: a clinic with a live
    // custom domain gets `https://{their-host}/…`, everyone else the path tier.
    const linkTarget = await resolveMicrositeLinkTarget(db, {
      id: org.id,
      slug: org.slug,
    });

    let manageUrl: string | undefined;
    const manageToken = await issueManageToken(db, {
      organizationId: org.id,
      appointmentId: bookingResult.data.appointmentId,
      appointmentEnd: bookingResult.data.appointmentEndTime,
      // Default (replace) is correct here: this email OWNS the patient's link
      // for this booking, so any token issued for it earlier should stop
      // working.
      replaceExisting: true,
    });
    if (manageToken.success) {
      manageUrl = buildManageBookingUrl(linkTarget, manageToken.data.token);
    } else {
      logError(
        'bookingForms.submitGeneralBooking.manageToken',
        new Error(manageToken.error.message),
        {
          feature: 'booking-forms',
          extra: {
            appointmentId: bookingResult.data.appointmentId,
            organizationId: org.id,
          },
        }
      );
    }

    sendEmail({
      to: email,
      subject: `Booking Confirmed: ${bookedServiceName} at ${org.name}`,
      template: BookingConfirmationEmail,
      props: {
        leadName: firstName,
        serviceName: bookedServiceName,
        formattedDate,
        formattedTime,
        appointmentDuration: bookedServiceDuration,
        organizationName: org.name,
        // The BRANCH the booking landed on, not the org. `undefined` (not
        // `null`) when unknown so the template's optional-prop check omits the
        // line entirely.
        organizationAddress: bookedLocationAddress ?? undefined,
        manageUrl,
        // Patient portal home (ENG-647) — the footer "your patient portal" link
        // and the fallback for the manage button when no magic link was minted.
        portalUrl: buildPortalHomeUrl(linkTarget),
      },
    }).catch((error) =>
      logError('bookingForms.submitGeneralBooking.confirmationEmail', error, {
        feature: 'booking-forms',
        extra: { appointmentId: bookingResult.data.appointmentId, email },
      })
    );
  }

  // ── Consent forms (ENG-647) — runs AFTER the booking commits ──────────────
  // Deliberately OUTSIDE withPublicOrgScope, for the same reason as the deposit
  // step below. `createSubmissionsForAppointment` opens its OWN system scope on
  // a different pooled connection, and it inserts `consent_form_submission`
  // rows carrying an FK to this `appointment`. Called from inside the scope
  // (which, with RLS_ENABLED, is an open transaction) that insert blocks on the
  // uncommitted appointment row's lock, and fails outright if the transaction
  // rolls back — with nothing to retry it, the patient would simply never get
  // their forms. Out here the row is committed and visible.
  //
  // Awaited but non-fatal: the booking is already committed, so a consent-form
  // failure is logged and the booking still succeeds.
  if (bookedServiceId) {
    const consentResult = await createSubmissionsForAppointment(db, {
      appointmentId: bookingResult.data.appointmentId,
      leadId: bookingResult.data.leadId,
      organizationId: org.id,
      serviceId: bookedServiceId,
    });
    if (!consentResult.success) {
      logError(
        'bookingForms.submitGeneralBooking.consentForms',
        new Error(consentResult.error.message),
        {
          feature: 'booking-forms',
          extra: {
            appointmentId: bookingResult.data.appointmentId,
            organizationId: org.id,
            code: consentResult.error.code,
          },
        }
      );
    }
  }

  // ── Deposit (per-clinic) — runs AFTER the booking commits ─────────────────
  // Deliberately OUTSIDE withPublicOrgScope: createDepositRequest makes a Stripe
  // API round-trip, and doing that inside the scoped SET LOCAL transaction (RLS
  // on) would hold a pooled connection idle-in-transaction across external I/O —
  // the pool-saturation anti-pattern. The booking is already committed here, so
  // a deposit failure (e.g. Stripe not connected) never blocks the appointment;
  // we just leave `deposit: null` and the confirmation screen skips the pay step.
  //
  // Governed by `resolveBookingPayment` — see `computedPayment` above.
  let deposit: GeneralBookingResult['deposit'] = null;
  const depositAmountCents = computedPayment.amountCents;

  if (depositAmountCents > 0 && !bookingPageUrl) {
    // Money is due and we have nowhere for Stripe to return the customer to, so
    // the checkout can't be opened. This used to fall through the `&&` in
    // silence — the one skip on this path that logged nothing. A caller that
    // omits `bookingPageUrl` gets a free booking and no trace of why.
    logError(
      'bookingForms.submitGeneralBooking.depositNoReturnUrl',
      new Error(
        'Payment due at booking but no bookingPageUrl to return from Stripe — booking confirmed without it'
      ),
      {
        feature: 'booking-forms',
        extra: {
          appointmentId: bookingResult.data.appointmentId,
          organizationId: org.id,
          depositAmountCents,
        },
      }
    );
  }

  if (depositAmountCents > 0 && bookingPageUrl) {
    // Read the org's Stripe Connect integration for its account currency (the
    // deposit must be charged in the connected account's currency) and to skip
    // gracefully when Stripe is not connected/active. Under RLS-on with no org
    // context this returns undefined → graceful skip (booking still confirmed).
    const integration = await db.query.stripeConnectIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, org.id),
    });

    if (!integration?.isActive || !integration.chargesEnabled) {
      // A deposit is required but the clinic has no Stripe account that can
      // charge — the booking still commits (we won't strand the customer), but
      // this is a real misconfiguration: the service form now gates the deposit
      // toggle on an active Stripe Connect, so this should only happen if Stripe
      // was disconnected AFTER the deposit was configured. Log it so it isn't
      // silent, and surface it on the clinic's radar.
      logError(
        'bookingForms.submitGeneralBooking.depositUncollectable',
        new Error(
          'Deposit required but Stripe Connect is not active/charges-enabled — booking confirmed without a deposit'
        ),
        {
          feature: 'booking-forms',
          extra: {
            appointmentId: bookingResult.data.appointmentId,
            organizationId: org.id,
            depositAmountCents,
            stripeActive: integration?.isActive ?? false,
            chargesEnabled: integration?.chargesEnabled ?? false,
          },
        }
      );
    } else {
      // The connected account's own currency wins — it is what Stripe will
      // actually charge in. Only when the account has none do we fall back, and
      // then to the org's country currency rather than a literal: this used to
      // default to 'gbp' here, 'eur' in the link generators and 'usd' at the
      // column, so one clinic could be billed in different currencies depending
      // which path ran. Country comes from the primary location, as it does in
      // `createSaleFromAppointment` — there is no org-level country column.
      let currency = integration.defaultCurrency ?? undefined;
      if (!currency) {
        const primaryLocation = await db.query.organizationLocation.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(eqOp(t.organizationId, org.id), eqOp(t.isPrimary, true)),
          columns: { country: true },
        });
        currency = currencyForCountry(
          primaryLocation?.country ?? null
        ).code.toLowerCase();
      }
      const sep = bookingPageUrl.includes('?') ? '&' : '?';
      const depositResult = await createDepositRequest(db, {
        appointmentId: bookingResult.data.appointmentId,
        organizationId: org.id,
        amountCents: depositAmountCents,
        currency,
        successUrl: `${bookingPageUrl}${sep}deposit=success`,
        cancelUrl: `${bookingPageUrl}${sep}deposit=cancelled`,
      });

      if (depositResult.success) {
        deposit = {
          amountCents: depositResult.data.deposit.amountCents,
          currency: depositResult.data.deposit.currency,
          checkoutUrl: depositResult.data.checkoutUrl,
          reason: computedPayment.reason,
        };
      } else {
        logError(
          'bookingForms.submitGeneralBooking.createDeposit',
          new Error(depositResult.error.message),
          {
            feature: 'booking-forms',
            extra: {
              appointmentId: bookingResult.data.appointmentId,
              organizationId: org.id,
              code: depositResult.error.code,
            },
          }
        );
      }
    }
  }

  return ok({ ...bookingResult.data, deposit });
};

export const submitGeneralBooking = (
  db: DbConnection,
  input: SubmitGeneralBookingInput
) =>
  trackedResult(
    'bookingForms.submitGeneralBooking',
    () => submitGeneralBookingImpl(db, input),
    {
      properties: {
        organizationSlug: input.organizationSlug,
        serviceId: input.serviceId,
      },
    }
  );

export type SubmitGeneralBookingResult = Awaited<
  ReturnType<typeof submitGeneralBooking>
>;
