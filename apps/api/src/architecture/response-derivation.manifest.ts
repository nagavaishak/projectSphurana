/**
 * GATE 4 — the asserted-response burn-down.
 *
 * Each entry is a file under `apps/api/src/assistant/{tools,ports}` and the
 * number of `apiFetch<T>` calls it still asserts rather than parses.
 *
 * `apiFetch<T>` does not connect `T` to the endpoint. It is the caller telling
 * the compiler what comes back, and two shipped defects came from exactly that
 * (`generateAdCopy` reading `data.headline` on a `content`-nested envelope;
 * `listServices` reading a `pricingDescription` column that does not exist).
 * Deriving the type from a contracts schema hands the field names to `tsc`.
 *
 * THIS MAP ONLY SHRINKS. A new file, or a higher count on an existing one,
 * fails the gate. See `response-derivation.spec.ts` for the regeneration
 * command and for what this gate deliberately cannot check.
 */
export const ASSERTED_BASELINE: Readonly<Record<string, number>> = {
  'apps/api/src/assistant/ports/lead-forms.adapter.ts': 5,
  'apps/api/src/assistant/ports/meta-ads.adapter.ts': 2,
  'apps/api/src/assistant/ports/videos.adapter.ts': 6,
  'apps/api/src/assistant/tools/ads/create-draft-ad.tool.ts': 1,
  'apps/api/src/assistant/tools/ads/delete-draft-ad.tool.ts': 1,
  'apps/api/src/assistant/tools/ads/diagnose-campaign.tool.ts': 1,
  'apps/api/src/assistant/tools/ads/duplicate-ad.tool.ts': 1,
  'apps/api/src/assistant/tools/ads/list-recent-ads.tool.ts': 2,
  'apps/api/src/assistant/tools/ads/replace-ad-creative.tool.ts': 1,
  'apps/api/src/assistant/tools/ads/suggest-ad-optimizations.tool.ts': 1,
  'apps/api/src/assistant/tools/content-tools.ts': 7,
  'apps/api/src/assistant/tools/context/list-recent-videos.tool.ts': 1,
  'apps/api/src/assistant/tools/videos/auto-select-clips.tool.ts': 1,
  'apps/api/src/assistant/tools/videos/delete-draft-video.tool.ts': 1,
  'apps/api/src/assistant/tools/videos/generate-video-script.tool.ts': 1,
  'apps/api/src/assistant/tools/videos/list-draft-clips.tool.ts': 1,
};
