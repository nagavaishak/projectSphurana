import type { BRollClipConfig } from '@borradh-workspace/database';

/**
 * A clip appears at most once in a video.
 *
 * This was not always true. Both selectors filled to the template's
 * `recommendedClipCount` by cycling what they had —
 * `claimedIds[i % claimedIds.length]` — so a service with two matched clips
 * produced needle-forehead, syringe-forehead, needle-forehead on a real botox
 * render. The footage was correct and the video looked broken, which is the
 * worse of the two failures: wrong footage reads as a bad match, repeated
 * footage reads as a bug.
 *
 * Nothing ever required the recommended count. Every template's b-roll slot
 * declares `count: [1, N]`, so one clip is a legal render and the engine
 * absorbs a short list by holding each clip longer. The count describes how the
 * video should FEEL; it is not a contract with the renderer, and padding it
 * with duplicates trades a real defect for a cosmetic metric.
 *
 * Enforced as a function rather than as care at each construction site because
 * there are three of them (reuse / claim / stock fallback), the reuse branch
 * replays a PREVIOUS render's list verbatim — carrying old duplicates into
 * every regeneration — and the next selector added will not have read the
 * comments on the other three.
 *
 * `order` is renumbered so it stays contiguous from 0 after a drop.
 */
export function dedupeBRollClips(clips: BRollClipConfig[]): BRollClipConfig[] {
  const seen = new Set<string>();
  const out: BRollClipConfig[] = [];
  for (const clip of clips) {
    if (seen.has(clip.assetId)) continue;
    seen.add(clip.assetId);
    out.push({ ...clip, order: out.length });
  }
  return out;
}
