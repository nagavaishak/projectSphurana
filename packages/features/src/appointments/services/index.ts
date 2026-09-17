export * from './create-appointment/index.js';
export * from './get-appointment/index.js';
export * from './list-appointments/index.js';
export * from './list-appointments-for-member/index.js';
export * from './update-appointment/index.js';
export * from './delete-appointment/index.js';

// Deposit services
export * from './create-deposit-request/index.js';
export * from './get-deposit/index.js';
export * from './cancel-deposit/index.js';
export * from './refund-deposit/index.js';
export * from './list-deposits/index.js';
export * from './handle-deposit-webhook/index.js';
export * from './check-expired-deposits/index.js';

// Reminders
export * from './send-reminders/index.js';
export * from './send-appointment-reminder/index.js';

// Deposit expiry (per-item, queue-driven)
export * from './expire-appointment-deposit/index.js';

// Hold expiry — releases `held` slots whose holdExpiresAt has passed, whether
// or not a deposit was ever attached.
export * from './expire-appointment-holds/index.js';

// One live hold per lead.
export * from './release-lead-holds/index.js';
// …and putting one back when the booking it made room for then failed.
export * from './restore-lead-holds/index.js';

// Reschedule email
export * from './send-reschedule-email/index.js';

// Practitioner notifications
export * from './notify-practitioner-booking/index.js';
export * from './notify-practitioner-cancellation/index.js';

// Owner notifications
export * from './notify-owner-booking/index.js';
export * from './notify-owner-cancellation/index.js';
export * from './notify-owner-reschedule/index.js';
export * from './notify-deposit-paid/index.js';

// Patient self-serve manage-booking (public, token-authenticated)
export * from './issue-manage-token/index.js';
export * from './revoke-manage-token/index.js';
export * from './get-managed-appointment/index.js';
export * from './cancel-managed-appointment/index.js';
export * from './reschedule-managed-appointment/index.js';

// Resource (room / equipment) allocation — shared across every lifecycle path.
// `releaseAppointmentResources` documents the invariant that makes the
// availability engine's missing `appointment.status` join sound; read it before
// adding a new status transition.
export * from './shared/index.js';
