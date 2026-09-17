import type { SocialPostStatus } from '@borradh-workspace/api-client/types';

/**
 * Mirrors the API's immutable social-post states. Keep every client-side edit
 * surface behind this policy so a lifecycle rule cannot drift between views.
 */
export function isSocialPostEditable(
  status: SocialPostStatus | null | undefined
): boolean {
  return status !== 'publishing' && status !== 'published';
}
