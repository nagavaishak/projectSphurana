/**
 * Sentinel values used when the user selects the built-in platform
 * email or calendar instead of connecting their own account.
 *
 * These are stored in sequence node metadata (JSONB), never in
 * the email_account or calendar_account tables.
 */
export const PLATFORM_EMAIL_ID = '__platform__';
export const PLATFORM_CALENDAR_ID = '__platform__';
