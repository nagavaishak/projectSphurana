import { trackedResult } from '@borradh-workspace/observability';

import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

import {
  type AppVersionCheck,
  type AppVersionPolicy,
  type CheckAppVersionInput,
  checkAppVersionSchema,
} from './check-app-version.schema.js';

/**
 * Compare two dot-separated numeric versions.
 *
 * Returns <0 when a is older, 0 when equal, >0 when a is newer. Missing
 * components count as 0, so "1.1" and "1.1.0" compare equal — the stores are
 * inconsistent about trailing zeros and a false "outdated" would block a user
 * who is perfectly up to date.
 */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const checkAppVersionImpl = async (
  input: CheckAppVersionInput,
  policy: AppVersionPolicy
): Promise<Result<AppVersionCheck>> => {
  const parsed = checkAppVersionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { version } = parsed.data;
  const minimumVersion = policy.minimumVersion ?? null;
  const latestVersion = policy.latestVersion ?? null;

  // Fail open, deliberately.
  //
  // This endpoint can hard-block every install of the app. A missing or
  // malformed env var must therefore degrade to "you're fine", never to
  // "everyone is blocked" — the blast radius of the safe direction is zero and
  // the blast radius of the other one is the whole install base, with no way to
  // ship a fix except through store review.
  let status: AppVersionCheck['status'] = 'ok';
  if (minimumVersion && compareVersions(version, minimumVersion) < 0) {
    status = 'update_required';
  } else if (latestVersion && compareVersions(version, latestVersion) < 0) {
    status = 'update_available';
  }

  return ok({
    status,
    currentVersion: version,
    minimumVersion,
    latestVersion,
    storeUrl: policy.storeUrl ?? null,
  });
};

/**
 * Decide whether a given app build is still allowed to run.
 *
 * Called on every cold start of every install, so success tracking is off —
 * one PostHog event per app launch would swamp the project for a check whose
 * interesting outcome is already visible in the response.
 */
export const checkAppVersion = (
  input: CheckAppVersionInput,
  policy: AppVersionPolicy
) =>
  trackedResult(
    'appVersion.checkAppVersion',
    () => checkAppVersionImpl(input, policy),
    {
      properties: { platform: input.platform, version: input.version },
      trackSuccess: false,
    }
  );

export type CheckAppVersionResult = Awaited<ReturnType<typeof checkAppVersion>>;
