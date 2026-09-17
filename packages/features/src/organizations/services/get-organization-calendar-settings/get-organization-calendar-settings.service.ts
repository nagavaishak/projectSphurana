import { organization, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';

export interface OrganizationCalendarSettings {
  /**
   * IANA zone the business operates in. The calendar renders every appointment
   * in this zone AND converts a picked wall-clock time back to an instant with
   * it, so omitting it here is not cosmetic: the frontend falls back to 'UTC'
   * and a manually-booked 9:15am is stored as 09:15Z (02:15 local for a US
   * Pacific org) while backend-created bookings land on the correct instant.
   */
  timezone: string;
  primaryCalendarType: string | null;
  /** Field of record for where the org takes bookings (ENG-500). */
  bookingDestination: string | null;
  defaultBookingLink: string | null;
  /**
   * Clinic-wide fallback appointment length, in minutes. The staff calendar
   * needs it to resolve a service that configures no duration through the same
   * ladder the public booking page uses (ENG-793); without it the dashboard
   * had no way to learn the org's default and fell back to a private literal.
   */
  defaultAppointmentDuration: number | null;
  depositEnabled: boolean;
  depositAmount: number | null;
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
  /** Portal self-rescheduling policy (ENG-647). NOT NULL column. */
  customerReschedulingEnabled: boolean;
  /** Portal self-cancellation policy (ENG-647). NOT NULL columns. */
  customerCancellationsEnabled: boolean;
  cancellationNoticeRequiredHours: number;
  chatbotSystemPrompt: string | null;
  chatbotSettings: Record<string, unknown> | null;
}

const getOrganizationCalendarSettingsImpl = async (
  db: DbConnection,
  organizationId: string
): Promise<Result<OrganizationCalendarSettings>> => {
  if (!organizationId) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Organization ID required')
    );
  }

  const [row] = await db
    .select({
      timezone: organization.timezone,
      primaryCalendarType: organization.primaryCalendarType,
      bookingDestination: organization.bookingDestination,
      defaultBookingLink: organization.defaultBookingLink,
      defaultAppointmentDuration: organization.defaultAppointmentDuration,
      depositEnabled: organization.depositEnabled,
      depositAmount: organization.depositAmount,
      reschedulingNoticeRequiredHours:
        organization.reschedulingNoticeRequiredHours,
      noShowOrLateCancelFeeCents: organization.noShowOrLateCancelFeeCents,
      customerReschedulingEnabled: organization.customerReschedulingEnabled,
      customerCancellationsEnabled: organization.customerCancellationsEnabled,
      cancellationNoticeRequiredHours:
        organization.cancellationNoticeRequiredHours,
      chatbotSystemPrompt: organization.chatbotSystemPrompt,
      chatbotSettings: organization.chatbotSettings,
    })
    .from(organization)
    .where(and(eq(organization.id, organizationId), notDeleted(organization)))
    .limit(1);

  if (!row) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  return ok({
    timezone: row.timezone || 'UTC',
    primaryCalendarType: row.primaryCalendarType ?? null,
    bookingDestination: row.bookingDestination ?? null,
    defaultBookingLink: row.defaultBookingLink ?? null,
    defaultAppointmentDuration: row.defaultAppointmentDuration ?? null,
    depositEnabled: row.depositEnabled ?? false,
    depositAmount: row.depositAmount ?? null,
    reschedulingNoticeRequiredHours:
      row.reschedulingNoticeRequiredHours ?? null,
    noShowOrLateCancelFeeCents: row.noShowOrLateCancelFeeCents ?? null,
    // NOT NULL columns — the fallbacks mirror the DB defaults for partial rows.
    customerReschedulingEnabled: row.customerReschedulingEnabled ?? true,
    customerCancellationsEnabled: row.customerCancellationsEnabled ?? true,
    cancellationNoticeRequiredHours: row.cancellationNoticeRequiredHours ?? 0,
    chatbotSystemPrompt: row.chatbotSystemPrompt ?? null,
    chatbotSettings: (row.chatbotSettings as Record<string, unknown>) ?? null,
  });
};

export const getOrganizationCalendarSettings = (
  db: DbConnection,
  organizationId: string
) =>
  trackedResult(
    'organization.getCalendarSettings',
    () =>
      withOrgScope(
        (tx) => getOrganizationCalendarSettingsImpl(tx, organizationId),
        { db }
      ),
    {
      properties: { organizationId },
      internalErrorsOnly: true,
    }
  );
