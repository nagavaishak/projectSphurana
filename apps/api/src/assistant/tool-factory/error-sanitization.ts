/**
 * Patterns that indicate an error message contains internal implementation
 * details that should not be exposed to the AI or frontend. Lifted verbatim
 * from the v2 controller.
 */
export const INTERNAL_ERROR_PATTERNS: readonly RegExp[] = [
  /\bselect\b.*\bfrom\b/i, // SQL queries
  /\binsert\b.*\binto\b/i,
  /\bupdate\b.*\bset\b/i,
  /\bdelete\b.*\bfrom\b/i,
  /\bECONNREFUSED\b/i, // Connection errors
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bpostgres/i, // Database names
  /\bredis/i,
  /\bdrizzle/i,
  /\bstack\s*trace/i, // Stack traces
  /at\s+\S+\s+\(.*:\d+:\d+\)/, // Stack frame
  /node_modules/i,
  /\bpassword\b/i, // Sensitive fields
  /\bsecret\b/i,
  /\btoken\b.*=\s*\S+/i,
  /localhost:\d+/i, // Internal URLs
  /127\.0\.0\.1/i,
];

/**
 * Status code → user-friendly fallback message mapping. Used when the raw
 * error contains internal details and we replace it.
 */
export const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication required',
  403: 'You do not have permission for this action',
  404: 'The requested resource was not found',
  409: 'This action conflicts with the current state',
  429: 'Too many requests, please try again later',
};

/**
 * Sanitize error messages from internal API calls. Strips SQL, connection
 * details, stack traces, and other implementation details.
 *
 * - If the message contains any internal pattern, replace with a friendly
 *   status-code message (or a generic fallback).
 * - Otherwise truncate at 200 chars to bound payload size in the streamed
 *   tool result.
 */
export function sanitizeApiError(message: string, statusCode: number): string {
  const containsInternalDetails = INTERNAL_ERROR_PATTERNS.some((p) =>
    p.test(message)
  );

  if (containsInternalDetails) {
    return (
      STATUS_MESSAGES[statusCode] ?? 'Something went wrong. Please try again.'
    );
  }

  if (message.length > 200) {
    return message.slice(0, 200);
  }

  return message;
}
