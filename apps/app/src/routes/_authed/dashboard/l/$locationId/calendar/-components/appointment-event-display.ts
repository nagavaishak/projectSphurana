import type { AppointmentStatus } from '@/features/appointments';
import {
  appointmentStatusLabels,
  appointmentStatusValues,
} from '@/features/appointments';

/**
 * Mobile sheet status copy. Post-migration the mobile labels match the
 * canonical appointment status labels (booked/confirmed/arrived/started/
 * completed/no_show/cancelled).
 */
export const appointmentMobileStatusLabels: Record<AppointmentStatus, string> =
  appointmentStatusLabels;

export const appointmentMobileStatusOptions = appointmentStatusValues.map(
  (value) => ({
    value,
    label: appointmentMobileStatusLabels[value],
  })
);

export function getAppointmentStatus(
  metadata?: Record<string, unknown>
): AppointmentStatus {
  const status = metadata?.status;
  if (
    typeof status === 'string' &&
    appointmentStatusValues.includes(status as AppointmentStatus)
  ) {
    return status as AppointmentStatus;
  }
  return 'booked';
}

interface AppointmentLeadRecord {
  firstName: string;
  lastName?: string | null;
  metadata?: Record<string, unknown> | null;
  formData?: Record<string, unknown> | null;
}

function isAppointmentLead(value: unknown): value is AppointmentLeadRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'firstName' in value &&
    typeof (value as AppointmentLeadRecord).firstName === 'string'
  );
}

export function formatLeadName(lead: unknown): string | undefined {
  if (!isAppointmentLead(lead)) {
    return undefined;
  }
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function readStringField(record: unknown, keys: string[]): string | undefined {
  if (!record || typeof record !== 'object') {
    return undefined;
  }
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Resolve a display name for the booked service. Appointments only store
 * `title` — never fall back to the full title as the service name.
 */
export function resolveServiceName(params: {
  title: string;
  leadName?: string;
  lead?: unknown;
  storedServiceName?: string;
}): string | undefined {
  const stored = params.storedServiceName?.trim();
  if (stored) {
    return stored;
  }

  if (isAppointmentLead(params.lead)) {
    const fromMetadata = readStringField(params.lead.metadata, [
      'interestedService',
      'interested_service',
      'service',
      'serviceName',
      'service_type',
      'serviceType',
    ]);
    if (fromMetadata) {
      return fromMetadata;
    }

    const fromFormData = readStringField(params.lead.formData, [
      'service',
      'serviceName',
      'service_type',
      'serviceType',
      'interestedService',
      'treatment',
    ]);
    if (fromFormData) {
      return fromFormData;
    }
  }

  const { title, leadName } = params;

  // Online booking / calendar sync: "Liposuction - Jane Doe"
  const dashSeparator = title.indexOf(' - ');
  if (dashSeparator > 0) {
    return title.slice(0, dashSeparator).trim();
  }

  // Manual title only when the suffix matches the linked lead: "Liposuction with Amy"
  if (leadName) {
    const suffix = ` with ${leadName}`;
    if (title.endsWith(suffix)) {
      return title.slice(0, -suffix.length).trim();
    }
  }

  return undefined;
}

export function getAppointmentEventDisplay(event: {
  title: string;
  description: string;
  user: { name: string };
  metadata?: Record<string, unknown>;
}) {
  const leadName =
    typeof event.metadata?.leadName === 'string'
      ? event.metadata.leadName
      : undefined;
  const staffMemberName =
    typeof event.metadata?.staffMemberName === 'string'
      ? event.metadata.staffMemberName
      : event.user.name;

  const serviceName =
    typeof event.metadata?.serviceName === 'string'
      ? event.metadata.serviceName
      : undefined;

  return {
    leadName,
    staffMemberName,
    serviceName,
    notes: event.description,
    status: getAppointmentStatus(event.metadata),
  };
}
