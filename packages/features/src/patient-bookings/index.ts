/**
 * Patient-portal bookings (ENG-647 Phase 1) — the patient's own view of
 * their appointments: list, reschedule, cancel. Reads run under
 * `withPatientScope`; writes reuse the owning appointments services under
 * system scope after the PatientAuthGuard has proven ownership.
 */
export * from './services/index.js';
