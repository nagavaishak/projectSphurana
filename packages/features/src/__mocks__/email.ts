/**
 * Canonical mock for `@borradh-workspace/email`.
 *
 * Aliased in vite.config.ts so the real email package (which would pull in the
 * AWS SESv2 / Resend clients and React Email rendering) is never loaded in
 * tests, and so every test file sees the *same* mock — a prerequisite for
 * `isolate: false`. See docs/plans/features-test-isolation-windows.md.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/email')` — import the
 * symbol and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())`
 * resets call history between tests.
 *
 * Email templates are React components in the real package. Here they are
 * behaviour-free `vi.fn()`s — they are only ever passed to `sendEmail`, which is
 * itself mocked, so the component is never rendered.
 */
import { vi } from 'vitest';

// --- Email sending utilities ---------------------------------------------
// Default to a RESOLVED promise (the real functions are async). Callers commonly
// fire-and-forget with `sendEmail(...).catch(...)`; a bare `vi.fn()` returns
// undefined and `.catch` on it throws. Resolving by default lets every test use
// the aliased mock without a local `vi.mock('@borradh-workspace/email')` (which
// would replace the shared module and break other files' captured references).
export const sendEmail = vi.fn().mockResolvedValue(undefined);
export const sendHtmlEmail = vi.fn().mockResolvedValue(undefined);

// --- Email client utilities ----------------------------------------------
export const testConnection = vi.fn();

// --- Email templates (React components, never rendered in tests) ----------
export const WelcomeEmail = vi.fn();
export const VerificationEmail = vi.fn();
export const InvitationEmail = vi.fn();
export const AppointmentReminderEmail = vi.fn();
export const AppointmentRescheduleEmail = vi.fn();
export const PractitionerBookingNotificationEmail = vi.fn();
export const PractitionerCancellationNotificationEmail = vi.fn();
export const PasswordResetEmail = vi.fn();
export const RequiresFollowUpEmail = vi.fn();
export const BookingConfirmationEmail = vi.fn();
export const OwnerBookingNotificationEmail = vi.fn();
export const StuckConversationsAlertEmail = vi.fn();
export const WeeklyDigestEmail = vi.fn();
export const MetaHealthAlertEmail = vi.fn();
export const PatientOtpEmail = vi.fn();
export const ConsentFormRequestEmail = vi.fn();
