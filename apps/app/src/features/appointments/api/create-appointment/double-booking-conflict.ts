/**
 * A `409` from `POST /appointments` that the user can DECIDE about.
 *
 * The endpoint returns 409 for three different things: the requested slot
 * overlaps an existing appointment for the same team member, the practitioner
 * is outside their availability, or the record already exists. Only the first
 * is recoverable by the user saying "yes, book it anyway" — the other two are
 * refusals, and offering to override them would be wrong.
 *
 * The overlap case is the only one that carries `conflictingAppointmentId` in
 * `details`, so that key — not the bare status — is the discriminator. See
 * `createAppointment` in the features package for where it is set (ENG-792).
 */
export interface DoubleBookingConflict {
  /** Human sentence naming the clashing appointment and its time. */
  message: string;
  conflictingAppointmentId: string;
}

export function asDoubleBookingConflict(
  error: unknown
): DoubleBookingConflict | null {
  if (!error || typeof error !== 'object') return null;

  const { response, details, message } = error as {
    response?: { status?: number };
    details?: Record<string, unknown>;
    message?: string;
  };

  // ky's HTTPError carries the Response; ApiClientError carries `status`.
  const status = response?.status ?? (error as { status?: number }).status;
  if (status !== 409) return null;

  const conflictingAppointmentId = details?.conflictingAppointmentId;
  if (typeof conflictingAppointmentId !== 'string') return null;

  return {
    message: message || 'This slot overlaps an existing appointment.',
    conflictingAppointmentId,
  };
}
