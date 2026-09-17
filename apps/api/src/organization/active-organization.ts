import { auth } from '@borradh-workspace/auth/server';
import { db, runWithRlsContext } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  getActiveOrganization,
  getOrganizationCalendarSettings,
} from '@borradh-workspace/features/organizations';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The two things `/organization/*` handlers all did before doing their actual
 * job: resolve "which org is this session on", and glue our own calendar row
 * onto Better Auth's organization record.
 *
 * Three of the four handlers opened with the SAME fourteen-line prologue
 * (`getActiveOrganization` → map the failure → 404 if there is no org → take
 * `.id`), which is most of why they were fat. It is one operation and it is
 * named once here.
 */

export interface ErrorShape {
  code: string;
  message: string;
}

interface ResolveOptions {
  /** The calling controller's own mapper — status codes stay identical. */
  mapError: (error: ErrorShape) => HttpException;
  /**
   * Optional WARN hook. Only `PATCH /organization/active` logged this failure;
   * the onboarding-task routes did not, and that difference is preserved
   * rather than tidied away.
   */
  logFailure?: (error: ErrorShape) => void;
}

/**
 * The id of the session's active organization.
 *
 * Throws the controller's mapped exception if the lookup fails, or a 404
 * `'No active organization set'` if the session has no org — both exactly as
 * the inline prologue did.
 */
export async function resolveActiveOrganizationId(
  sessionToken: string,
  { mapError, logFailure }: ResolveOptions
): Promise<string> {
  const activeResult = await getActiveOrganization(auth.api, { sessionToken });

  if (!activeResult.success) {
    logFailure?.(activeResult.error);
    throw mapError(activeResult.error);
  }

  if (!activeResult.data.organization) {
    throw new HttpException('No active organization set', HttpStatus.NOT_FOUND);
  }

  return activeResult.data.organization.id;
}

/**
 * Enrich Better Auth's organization record with the calendar/booking settings
 * that live in OUR database.
 *
 * Every field falls back to a literal (`null`, or `false` for `depositEnabled`)
 * when the settings lookup fails, so a settings-row problem degrades the
 * response rather than failing the request. The frontend reads these fields
 * unconditionally — keep the fallbacks and keep them exactly these values.
 */
export async function withCalendarSettings<T extends { id: string }>(
  org: T,
  userId: string
) {
  // Enrich with calendar settings from our database (not stored in Better Auth).
  // getOrganizationCalendarSettings runs through withOrgScope, which (RLS on)
  // requires an org context in AsyncLocalStorage. The RlsInterceptor only
  // populates it from the SESSION's activeOrganizationId — but getActive
  // resolves an org even when the session has none set yet (fresh sign-in,
  // single-org fallback), so the interceptor would have skipped. Bind the
  // resolved org explicitly so withOrgScope never fail-fasts here.
  const calendarResult = await runWithRlsContext(
    { organizationId: org.id, userId },
    () => getOrganizationCalendarSettings(db, org.id)
  );

  return {
    ...org,
    // Better Auth's organization object only carries the fields declared in
    // `organizationSetup.schema` — `timezone` is not one of them, so it can
    // only reach the client from here. Without it the calendar silently falls
    // back to 'UTC' for EVERY org: manual bookings are written as if the
    // picked wall-clock were UTC, while booking-form/Claire bookings (created
    // server-side in the real zone) render hours out.
    timezone: calendarResult.success ? calendarResult.data.timezone : 'UTC',
    primaryCalendarType: calendarResult.success
      ? calendarResult.data.primaryCalendarType
      : null,
    bookingDestination: calendarResult.success
      ? calendarResult.data.bookingDestination
      : null,
    defaultBookingLink: calendarResult.success
      ? calendarResult.data.defaultBookingLink
      : null,
    // The org-wide fallback appointment length. The staff calendar resolves a
    // null-duration service through it so a booking made here is the same
    // length as one made from the public booking page (ENG-793).
    defaultAppointmentDuration: calendarResult.success
      ? calendarResult.data.defaultAppointmentDuration
      : null,
    depositEnabled: calendarResult.success
      ? calendarResult.data.depositEnabled
      : false,
    depositAmount: calendarResult.success
      ? calendarResult.data.depositAmount
      : null,
    chatbotSystemPrompt: calendarResult.success
      ? calendarResult.data.chatbotSystemPrompt
      : null,
    chatbotSettings: calendarResult.success
      ? calendarResult.data.chatbotSettings
      : null,
    reschedulingNoticeRequiredHours: calendarResult.success
      ? calendarResult.data.reschedulingNoticeRequiredHours
      : null,
    noShowOrLateCancelFeeCents: calendarResult.success
      ? calendarResult.data.noShowOrLateCancelFeeCents
      : null,
    // NOT NULL columns — the failure fallbacks mirror the DB defaults so the
    // settings UI degrades to "cancellations on, no notice" rather than
    // rendering an impossible null state.
    customerReschedulingEnabled: calendarResult.success
      ? calendarResult.data.customerReschedulingEnabled
      : true,
    customerCancellationsEnabled: calendarResult.success
      ? calendarResult.data.customerCancellationsEnabled
      : true,
    cancellationNoticeRequiredHours: calendarResult.success
      ? calendarResult.data.cancellationNoticeRequiredHours
      : 0,
  };
}

/**
 * The active organization as the dashboard consumes it.
 *
 * `marketingUrl` is deployment config, not org data — but the dashboard needs
 * it and has no other way to learn it. It links out to surfaces that live on
 * the marketing app (booking, the portal, the venue page) and used to DERIVE
 * that host from its own (`app.x` -> `www.x`), which is wrong anywhere the
 * pattern does not hold: on a Vercel preview the dashboard has a branch alias
 * and marketing does not, so every such link stayed on the dashboard host and
 * 404'd. The API knows the answer in every environment, so it says so.
 *
 * Lives here rather than in the controller because the composition IS the use
 * case — Gate 5 is what noticed.
 */
export async function readActiveOrganization<T extends { id: string }>(
  org: T,
  userId: string
) {
  return {
    ...(await withCalendarSettings(org, userId)),
    marketingUrl: apiEnv.MARKETING_URL ?? apiEnv.WEB_URL ?? null,
  };
}
