/**
 * Assistant tools — entry point.
 *
 * Post-W-C05 / W-C10:
 *   - Ads tools (`tools/ads/`) are factory-shaped; the legacy `ad-tools.ts`
 *     is gone, along with its in-memory confirmation flow. Tokens for
 *     destructive ad actions go through the W-C02-B DB store via the
 *     factory's `createConfirmation` / `verifyConfirmation` helpers.
 *   - Video tools (`tools/videos/`) are factory-shaped (W-C10). Legacy
 *     `video-tools.ts` removed; queue/execute pair uses DB-backed tokens
 *     bound to the new `queue_video_export` enum value.
 *   - Content tools (`createContentTools`) still close over the legacy
 *     `AssistantToolsContext`, but the destructive schedule/publish tools that
 *     used the in-memory `confirmation-store.ts` are GONE (W-C09, Phase 6):
 *     the `social_posts_schedulePost` / `social_posts_publishPostNow` factory
 *     tools (DB-backed confirmation tokens, governed by the turn-boundary
 *     rule) are the only launch path now. The remaining `createContentTools`
 *     entries are non-destructive (list / draft / caption / timing) and touch
 *     no confirmation store, so the in-memory store and its ctx helpers were
 *     deleted.
 *   - The legacy `AssistantToolsContext` interface + `safeExternalId` schema
 *     stay exported because `content-tools.ts` still imports them.
 */
import { z } from 'zod';

export const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

/**
 * Legacy context passed into `createContentTools`. Kept stable so
 * `content-tools.ts` compiles until its Phase 3 port replaces it.
 */
export interface AssistantToolsContext {
  organizationId: string;
  userId: string;
  /** Authenticated fetch helper for calling NestJS API endpoints internally */
  apiFetch: <T = unknown>(
    path: string,
    options?: { method?: string; body?: unknown }
  ) => Promise<T>;
  cdnUrl?: string;
  appUrl?: string;
}

export { adsTools } from './ads/index.js';
export { appointmentsTools } from './appointments/index.js';
export { campaignsTools } from './campaigns/index.js';
export { contentBatchesTools } from './content-batches/index.js';
export { contentTools } from './content/index.js';
export { contextTools } from './context/index.js';
export { customerConversationsTools } from './customer-conversations/index.js';
export { leadsTools } from './leads/index.js';
export { leadFormsTools } from './lead-forms/index.js';
export { orgDefaultsTools } from './org-defaults/index.js';
export { socialPostsTools } from './social-posts/index.js';
export { supportTools } from './support/index.js';
export { videosTools } from './videos/index.js';
export { legacyToolsToFactoryShape } from './legacy-shim.js';
export { createContentTools } from './content-tools.js';
