import type { TeamMemberFormValues } from '../../components/team-member-editor/types';
import type { CreateTeamMemberPayload } from './create-team-member.hook';

/**
 * The ONE place the composite "Add team member" (`POST practitioners/team-member`)
 * body is assembled from the editor's form values. Moved off the component so
 * the wire shape lives beside the mutation hook, not inline in the surface.
 */

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCents(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function buildCreateTeamMemberPayload(
  values: TeamMemberFormValues
): CreateTeamMemberPayload {
  const wage = values.wage;
  const isHourly = wage.compensationType === 'hourly';
  const showOvertime = isHourly && wage.overtimeEnabled;

  return {
    photo: trimOrUndefined(values.photo),
    firstName: trimOrUndefined(values.firstName),
    lastName: trimOrUndefined(values.lastName),
    email: values.email.trim(),
    phone: trimOrUndefined(values.phone),
    phoneSecondary: trimOrUndefined(values.phoneSecondary),
    phoneCountry: trimOrUndefined(values.phoneCountry),
    country: values.country || undefined,
    dateOfBirth: trimOrUndefined(values.dateOfBirth),
    employmentStartDate: trimOrUndefined(values.employmentStartDate),
    employmentEndDate: trimOrUndefined(values.employmentEndDate),
    employmentType: values.employmentType || undefined,
    teamMemberRef: trimOrUndefined(values.teamMemberRef),
    notes: trimOrUndefined(values.notes),
    acceptsBookings: values.acceptsBookings,
    jobTitle: trimOrUndefined(values.jobTitle),
    color: values.color || undefined,
    permissionLevel: values.permissionLevel,
    serviceIds: values.serviceIds,
    locationIds: values.locationIds,
    wageConfig: {
      compensationType: wage.compensationType,
      hourlyRateCents: isHourly ? parseCents(wage.hourlyRate) : null,
      overtimeEnabled: isHourly ? wage.overtimeEnabled : false,
      regularWorkHours: showOvertime
        ? Number.parseFloat(wage.regularWorkHours) || null
        : null,
      regularWorkHoursPer: wage.regularWorkHoursPer,
      overtimeType: showOvertime ? wage.overtimeType : null,
      overtimeMultiplier:
        showOvertime && wage.overtimeType === 'multiplier'
          ? Number.parseFloat(wage.overtimeMultiplier) || null
          : null,
      overtimeHourlyRateCents:
        showOvertime && wage.overtimeType === 'hourly_rate'
          ? parseCents(wage.overtimeHourlyRate)
          : null,
      autoClockIn: wage.autoClockIn,
      autoClockOut: wage.autoClockOut,
      automatedBreaks: wage.automatedBreaks,
      locationRestriction: wage.locationRestriction,
    },
  };
}
