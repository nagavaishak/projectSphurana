// Test data for the marketing-astro e2e suite. Mirrors the
// apps/app-e2e/src/fixtures pattern: values come from .env.test (or CI
// env), and any referenced entity must already exist on the target API
// (created by ops, not by the test).

export const TEST_DATA = {
  /**
   * A real organisation slug with a public booking page enabled, existing
   * on whatever API the target environment is wired to. When unset, the
   * booking spec is skipped.
   */
} as const;

export {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  fillHydrated,
  portalPath,
  requireSeed,
  waitForIslands,
  type SeededLead,
} from './portal-seed.fixture.js';

export {
  ALL_WEEK_WORKING_HOURS,
  bookingPath,
  createBookablePractitioner,
  createService,
  createServiceVariant,
  nearFutureWeekdayLabel,
  type SeededService,
} from './booking-seed.fixture.js';

export {
  createConsentTemplate,
  createStaffAppointment,
  requireConsentForService,
  setAppointmentStatus,
  waitForConsentSubmissions,
  type SeededAppointment,
  type SeededConsentTemplate,
  type StaffConsentSubmission,
} from './consent-seed.fixture.js';
