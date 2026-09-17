import { orgDefaults, withOrgScope } from '@borradh-workspace/database';
import {
  giftCardExpiryValues,
  resourceAssignmentModeValues,
} from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { OrgDefaults } from '../../models/types.js';
import { SYSTEM_DEFAULTS } from '../system-defaults.js';
import {
  type GetOrgDefaultsInput,
  getOrgDefaultsSchema,
} from './get-org-defaults.schema.js';

type OverrideKey = Exclude<keyof OrgDefaults, 'organizationId'>;

const OVERRIDE_KEYS: OverrideKey[] = [
  'adDailyBudgetCents',
  'adObjective',
  'videoOrientation',
  'videoLengthSecs',
  'brandVoice',
  'defaultServiceIdForAds',
  'adAreaType',
  'wageAutoClockIn',
  'wageAutoClockOut',
  'wageAutomatedBreaks',
  'giftCardPresetAmounts',
  'giftCardExpiry',
  'resourceAssignmentMode',
];

export interface OrgDefaultsWithOverrides extends OrgDefaults {
  /**
   * Map of field-name → boolean indicating whether the value is an org-level
   * override (`true`) or coming from the system fallback (`false`). The UI
   * uses this to render "system default" hints next to unset fields.
   */
  overrides: Record<OverrideKey, boolean>;
}

const getOrgDefaultsWithOverridesImpl = async (
  db: DbConnection,
  input: GetOrgDefaultsInput
): Promise<Result<OrgDefaultsWithOverrides>> => {
  const parsed = getOrgDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const row = await db.query.orgDefaults.findFirst({
      where: eq(orgDefaults.organizationId, organizationId),
    });

    // Always succeed: when no row exists, use system defaults.
    const resolved: OrgDefaults = {
      organizationId,
      adDailyBudgetCents:
        row?.adDailyBudgetCents ?? SYSTEM_DEFAULTS.adDailyBudgetCents,
      adObjective: row?.adObjective ?? SYSTEM_DEFAULTS.adObjective,
      videoOrientation:
        row?.videoOrientation ?? SYSTEM_DEFAULTS.videoOrientation,
      videoLengthSecs: row?.videoLengthSecs ?? SYSTEM_DEFAULTS.videoLengthSecs,
      brandVoice: row?.brandVoice ?? null,
      defaultServiceIdForAds: row?.defaultServiceIdForAds ?? null,
      adAreaType: row?.adAreaType ?? null,
      wageAutoClockIn: row?.wageAutoClockIn ?? SYSTEM_DEFAULTS.wageAutoClockIn,
      wageAutoClockOut:
        row?.wageAutoClockOut ?? SYSTEM_DEFAULTS.wageAutoClockOut,
      wageAutomatedBreaks:
        row?.wageAutomatedBreaks ?? SYSTEM_DEFAULTS.wageAutomatedBreaks,
      giftCardPresetAmounts: row?.giftCardPresetAmounts ?? [
        ...SYSTEM_DEFAULTS.giftCardPresetAmounts,
      ],
      giftCardExpiry:
        row?.giftCardExpiry && giftCardExpiryValues.includes(row.giftCardExpiry)
          ? row.giftCardExpiry
          : SYSTEM_DEFAULTS.giftCardExpiry,
      resourceAssignmentMode:
        row?.resourceAssignmentMode &&
        resourceAssignmentModeValues.includes(row.resourceAssignmentMode)
          ? row.resourceAssignmentMode
          : SYSTEM_DEFAULTS.resourceAssignmentMode,
    };

    const overrides = OVERRIDE_KEYS.reduce(
      (acc, key) => {
        acc[key] = row != null && row[key] != null;
        return acc;
      },
      {} as Record<OverrideKey, boolean>
    );

    return ok({ ...resolved, overrides });
  } catch (error) {
    logError('orgDefaults.get', error, {
      feature: 'org-defaults',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get org defaults')
    );
  }
};

const getOrgDefaultsImpl = async (
  db: DbConnection,
  input: GetOrgDefaultsInput
): Promise<Result<OrgDefaults>> => {
  const result = await getOrgDefaultsWithOverridesImpl(db, input);
  if (!result.success) return result;
  const { overrides: _overrides, ...resolved } = result.data;
  return ok(resolved);
};

export const getOrgDefaults = (db: DbConnection, input: GetOrgDefaultsInput) =>
  trackedResult(
    'orgDefaults.get',
    () => withOrgScope((tx) => getOrgDefaultsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export const getOrgDefaultsWithOverrides = (
  db: DbConnection,
  input: GetOrgDefaultsInput
) =>
  trackedResult(
    'orgDefaults.getWithOverrides',
    () =>
      withOrgScope((tx) => getOrgDefaultsWithOverridesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type GetOrgDefaultsResult = Awaited<ReturnType<typeof getOrgDefaults>>;
export type GetOrgDefaultsWithOverridesResult = Awaited<
  ReturnType<typeof getOrgDefaultsWithOverrides>
>;
