import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeriveAutoClockInput,
  type ResolveAutomationFlagsInput,
  deriveAutoClockSchema,
  resolveAutomationFlagsSchema,
} from './derive-auto-clock.schema.js';

export interface ResolvedAutomationFlags {
  autoClockIn: boolean;
  autoClockOut: boolean;
  automatedBreaks: boolean;
}

export interface AutoClockActions {
  /** Insert an `open` time entry with `clockIn = at`, source 'auto'. */
  clockIn: { at: Date } | null;
  /** Close the open entry: `clockOut = at`, status → 'completed'. */
  clockOut: { timeEntryId: string; at: Date } | null;
}

/**
 * Resolve the three automation flags per contract §1.5: the
 * practitioner_wage_config value, where `workspace_default` falls through to
 * the org_defaults boolean, which falls through to the system default false.
 *
 * Pure, synchronous — no trackedResult (nothing effectful to track).
 */
export const resolveAutomationFlags = (
  input: ResolveAutomationFlagsInput
): Result<ResolvedAutomationFlags> => {
  const parsed = resolveAutomationFlagsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { wageConfig, orgDefaults } = parsed.data;

  const resolve = (
    setting: 'workspace_default' | 'enabled' | 'disabled' | undefined,
    orgDefault: boolean | null | undefined
  ): boolean => {
    if (setting === 'enabled') return true;
    if (setting === 'disabled') return false;
    // workspace_default (or missing wage config row) → org default → false
    return orgDefault ?? false;
  };

  return ok({
    autoClockIn: resolve(wageConfig?.autoClockIn, orgDefaults?.wageAutoClockIn),
    autoClockOut: resolve(
      wageConfig?.autoClockOut,
      orgDefaults?.wageAutoClockOut
    ),
    automatedBreaks: resolve(
      wageConfig?.automatedBreaks,
      orgDefaults?.wageAutomatedBreaks
    ),
  });
};

/**
 * Pure auto-clock derivation (contract §1.5 frozen behavior):
 *
 * - autoClockIn enabled: at/after the resolved shift start, if no open entry
 *   exists, clock in with `clock_in = shift start`. DECISION: only while the
 *   shift window is still running (`now < end`) — otherwise a long-past shift
 *   would spawn a dangling open entry when autoClockOut is disabled.
 * - autoClockOut enabled: at/after shift end, close any open entry with
 *   `clock_out = shift end`. The closing instant is the latest window end
 *   that is `<= now` and after the entry's clock-in.
 *
 * Both actions can be emitted in one evaluation (close yesterday's window,
 * open the current one): `clockIn` is derived as if `clockOut` was applied.
 */
const deriveAutoClockImpl = (
  input: DeriveAutoClockInput
): Result<AutoClockActions> => {
  const parsed = deriveAutoClockSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { now, flags, shiftWindows, openEntry } = parsed.data;
  const nowMs = now.getTime();

  const actions: AutoClockActions = { clockIn: null, clockOut: null };

  // --- auto clock-out -------------------------------------------------------
  if (flags.autoClockOut && openEntry) {
    const closableEnds = shiftWindows
      .map((w) => w.end.getTime())
      .filter((endMs) => endMs <= nowMs && endMs > openEntry.clockIn.getTime());
    if (closableEnds.length > 0) {
      actions.clockOut = {
        timeEntryId: openEntry.id,
        at: new Date(Math.max(...closableEnds)),
      };
    }
  }

  // --- auto clock-in --------------------------------------------------------
  const effectivelyOpen = openEntry !== null && actions.clockOut === null;
  if (flags.autoClockIn && !effectivelyOpen) {
    const currentWindow = shiftWindows
      .filter((w) => w.start.getTime() <= nowMs && nowMs < w.end.getTime())
      .sort((a, b) => b.start.getTime() - a.start.getTime())[0];
    if (currentWindow) {
      // Never re-open the window we just derived a close for (same instant).
      const closedAt = actions.clockOut?.at.getTime();
      if (closedAt === undefined || currentWindow.start.getTime() >= closedAt) {
        actions.clockIn = { at: currentWindow.start };
      }
    }
  }

  return ok(actions);
};

/**
 * Pure, synchronous derivation — exported without trackedResult (no I/O; the
 * effectful `run-auto-clock` orchestrator that consumes it is tracked).
 */
export const deriveAutoClock = deriveAutoClockImpl;
