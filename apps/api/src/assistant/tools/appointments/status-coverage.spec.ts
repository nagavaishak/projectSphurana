import {
  type AppointmentStatus,
  type ServicePriceType,
  appointmentStatusValues,
  claireConfirmationActionValues,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import { createServiceTool } from '../context/create-service.tool.js';
import { updateServiceTool } from '../context/update-service.tool.js';
import { appointmentsTools } from './index.js';

// Short-circuit heavy barrels — importing the tool objects transitively pulls
// in the database + features/assistant barrels (ESM-only deps the api/jest swc
// transform doesn't handle). These tools never touch them at import time; we
// only read their static `.action` shape here.
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

/**
 * DRIFT GATE (fresha-clone). The fresha data models introduced new
 * `appointment_status` and `service_price_type` enum values. History shows the
 * failure mode: an enum grows in `packages/labels`, but Claire's tools + prompt
 * + fixtures lag behind for weeks (no no-show tool, no variant wiring, a stale
 * "pricing is informational only" prompt).
 *
 * These tests are the trip-wire. When someone adds an `appointment_status` or
 * `service_price_type` value, one of these fails until the corresponding tool
 * coverage is wired up — forcing the tool/prompt/fixture catch-up in the same
 * PR instead of silently shipping an enum Claire can't touch.
 *
 * The maps below are HAND-MAINTAINED on purpose: adding a status means
 * consciously deciding which tool sets it (or that Claire deliberately doesn't).
 */

/**
 * Every appointment status → the tool/action by which Claire reaches it, or an
 * explicit `null` for statuses Claire is intentionally not allowed to set.
 */
const STATUS_COVERAGE: Record<AppointmentStatus, string | null> = {
  booked: 'bookAppointment', // set at creation
  confirmed: 'setAppointmentStatus',
  arrived: 'setAppointmentStatus',
  started: 'setAppointmentStatus',
  completed: 'setAppointmentStatus',
  no_show: 'markNoShow',
  cancelled: 'cancelAppointment',
  // Set at creation by the chatbot's direct-booking flow, and left by payment
  // (→ confirmed) or by `expireAppointmentHolds` (→ cancelled). Deliberately
  // NOT reachable from `setAppointmentStatus`: putting a confirmed booking back
  // into `held` would arm a clock that later cancels a real appointment.
  held: null,
};

/**
 * Every service price type → whether Claire can set it. All four are settable
 * via `createService` / `updateService` (`priceType` accepts the full enum).
 */
const PRICE_TYPE_COVERAGE: Record<
  ServicePriceType,
  'createService/updateService'
> = {
  fixed: 'createService/updateService',
  from: 'createService/updateService',
  free: 'createService/updateService',
  poa: 'createService/updateService',
};

describe('drift gate: appointment_status coverage', () => {
  it('maps every appointment_status value to a tool (or explicit null)', () => {
    // If this fails, a status was added/removed in @borradh-workspace/labels
    // without deciding how Claire handles it. Update STATUS_COVERAGE (and add
    // the tool + eval fixture) to fix.
    expect(Object.keys(STATUS_COVERAGE).sort()).toEqual(
      [...appointmentStatusValues].sort()
    );
  });

  it('registers every appointment-setting tool named in the coverage map', () => {
    const registeredActions = new Set(appointmentsTools.map((t) => t.action));
    const referencedTools = new Set(
      Object.values(STATUS_COVERAGE).filter((v): v is string => v !== null)
    );
    const missing = [...referencedTools].filter(
      (action) => !registeredActions.has(action)
    );
    // Non-empty means STATUS_COVERAGE names a tool that isn't registered in
    // appointmentsTools — wire the tool up (or fix the map).
    expect(missing).toEqual([]);
  });

  it('gates no_show and cancelled behind confirmation-required actions', () => {
    // No-show and cancellation are customer-affecting → must be destructive
    // actions the operator confirms. Both actions must be in the confirmation
    // enum so the factory can issue a token for them.
    expect(claireConfirmationActionValues).toContain('mark_no_show');
    expect(claireConfirmationActionValues).toContain('cancel_appointment');
  });
});

describe('drift gate: service_price_type coverage', () => {
  it('maps every service_price_type value to Claire tooling', () => {
    expect(Object.keys(PRICE_TYPE_COVERAGE).sort()).toEqual(
      [...servicePriceTypeValues].sort()
    );
  });

  it('create/update-service tools are registered destructive actions', () => {
    expect(createServiceTool.action).toBe('createService');
    expect(updateServiceTool.action).toBe('updateService');
    expect(claireConfirmationActionValues).toContain('create_service');
    expect(claireConfirmationActionValues).toContain('update_service');
  });
});
