/**
 * 409 CONFLICT is a FIRST-CLASS OUTCOME in resource scheduling, not an error.
 *
 * Three endpoints answer 409 as a normal part of their contract:
 *
 *  - `DELETE resources/:id`            — the room still has upcoming bookings
 *  - `DELETE resources/categories/:id` — the category still holds resources
 *  - `PUT appointments/:id/resources`  — the target room is already taken
 *
 * In every case the user has a real next move ("Deactivate instead",
 * "Move those bookings first", "Force"). Flattening that into the generic red
 * `toast.error(error.message)` every other mutation uses would throw away the
 * only actionable branch the UI has — so these hooks surface the conflict as a
 * distinct outcome and deliberately DO NOT toast it.
 *
 * READING THE STATUS (the subtle part)
 * ------------------------------------
 * `isApiClientError()` alone does NOT work, and it fails silently. The
 * api-client is built on ky, whose `beforeError` hook augments and re-throws
 * ky's own `HTTPError` — it never constructs an `ApiClientError`. So
 * `isApiClientError(error)` is always false for a real HTTP failure and any
 * `error.status` read off it is `undefined`, which would make every conflict
 * look like a plain error. Read the status structurally instead, from whichever
 * shape actually arrives. Same fix as `features/website/api/use-microsite.ts`.
 */

import { isApiClientError } from '@borradh-workspace/api-client';

/** The HTTP status behind a failed request, whatever error shape arrived. */
export const statusOf = (error: unknown): number | undefined => {
  if (isApiClientError(error)) return error.status;
  const response = (error as { response?: { status?: number } } | null)
    ?.response;
  return response?.status;
};

/** True when the API answered 409 — the expected, recoverable outcome. */
export const isConflictError = (error: unknown): boolean =>
  statusOf(error) === 409;

/**
 * A 409 modelled for the UI.
 *
 * `message` is the API's own copy, which already reads as instructions
 * ("Room 2 has 4 upcoming bookings. Deactivate it instead, or move those
 * bookings first.") — render it verbatim rather than inventing a second
 * wording that can drift from the backend's.
 */
export interface ResourceConflict {
  /** The API's user-facing message. Safe to render as-is. */
  message: string;
  /** Machine code from the response body when the API sent one. */
  code?: string;
  /** Structured `details` the api-client lifted off the 409 body. */
  details?: Record<string, unknown>;
  /**
   * How many rows are blocking (upcoming bookings, or resources still in the
   * category), when the API said so. Read from `details` first; the message
   * regex is only a fallback for an endpoint that sends prose alone.
   */
  count?: number;
  /** The original error, for logging / Sentry. */
  cause: unknown;
}

/** Numeric `details` fields the resources endpoints use to carry the count. */
const COUNT_KEYS = [
  'count',
  'upcomingCount',
  'upcomingBookings',
  'appointmentCount',
  'resourceCount',
] as const;

const countFromDetails = (
  details: Record<string, unknown> | undefined
): number | undefined => {
  if (!details) return undefined;
  for (const key of COUNT_KEYS) {
    const value = details[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

/**
 * Fallback for a 409 whose body is prose only. Deliberately anchored to the
 * noun so a stray number elsewhere in the sentence cannot be mistaken for the
 * count — "Room 2 has 4 upcoming bookings" must yield 4, never 2.
 */
const countFromMessage = (message: string): number | undefined => {
  const match = message.match(
    /(\d+)\s+(?:upcoming\s+)?(?:bookings?|appointments?|resources?)\b/i
  );
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Narrow an unknown error to a `ResourceConflict`, or `null` if it is not a
 * 409 (in which case the caller should fall through to its normal error toast).
 */
export const toResourceConflict = (
  error: unknown,
  fallbackMessage: string
): ResourceConflict | null => {
  if (!isConflictError(error)) return null;

  const augmented = error as {
    message?: string;
    code?: string;
    details?: Record<string, unknown>;
  };
  const message = augmented.message || fallbackMessage;

  return {
    message,
    code: augmented.code,
    details: augmented.details,
    count: countFromDetails(augmented.details) ?? countFromMessage(message),
    cause: error,
  };
};
