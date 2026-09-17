import { z } from 'zod';

/**
 * Platforms that can be gated. `web` is deliberately absent: the browser app
 * always loads the current bundle, so there is no such thing as an outdated
 * web client to gate.
 */
export const checkAppVersionSchema = z.object({
  platform: z.enum(['ios', 'android']),
  // Marketing version as the store shows it (CFBundleShortVersionString /
  // versionName), e.g. "1.0.4". Not the build number.
  version: z
    .string()
    .min(1, 'Version required')
    .regex(
      /^\d+(\.\d+)*$/,
      'Version must be dot-separated numbers, e.g. 1.0.4'
    ),
});

export type CheckAppVersionInput = z.infer<typeof checkAppVersionSchema>;

/**
 * Version policy, supplied by the caller rather than read from env here so the
 * service stays pure and testable. The API layer maps env vars onto this.
 *
 * Every field is optional. A platform with no `minimumVersion` configured is
 * never gated — see the fail-open note on the service.
 */
export interface AppVersionPolicy {
  /** Below this, the app is blocked. Omit to disable blocking entirely. */
  minimumVersion?: string;
  /** Newest version in the store. Below this, the app nudges. */
  latestVersion?: string;
  /** Where to send the user to update. */
  storeUrl?: string;
}

export type AppVersionStatus = 'ok' | 'update_available' | 'update_required';

export interface AppVersionCheck {
  status: AppVersionStatus;
  currentVersion: string;
  minimumVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
}
