/**
 * Scene Converter
 *
 * Merges consecutive same-asset clips and converts scheduled clips
 * to Remotion-compatible scene format.
 */

import type { BRollClip, ScheduledBRollClip } from './b-roll-scheduler.js';

/**
 * Merge consecutive scheduled clips that share the same source asset into one
 * longer, continuous clip. This prevents jarring fade-to-black-fade-back
 * transitions between segments of the same video.
 *
 * When merged, the resulting clip's trimStart is kept from the first clip and
 * the duration extends to cover the gap and subsequent same-asset clips.
 * If the source is too short for continuous playback, the trim resets to 0.
 * If the source is still too short, clips are left unmerged.
 */
export function mergeConsecutiveSameAssetClips(
  scheduled: ScheduledBRollClip[],
  sourceClips: BRollClip[]
): ScheduledBRollClip[] {
  if (scheduled.length <= 1) return scheduled;

  // Build a lookup for source durations
  const sourceDurationMap = new Map<string, number>();
  for (const clip of sourceClips) {
    sourceDurationMap.set(clip.id, clip.sourceDurationSec);
  }

  const result: ScheduledBRollClip[] = [];
  let i = 0;

  while (i < scheduled.length) {
    const current = { ...scheduled[i] };

    // Look ahead and merge consecutive same-asset clips
    while (i + 1 < scheduled.length && scheduled[i + 1].id === current.id) {
      const next = scheduled[i + 1];
      const mergedEndTime = next.startTimeSec + next.durationSec;
      const mergedDuration = mergedEndTime - current.startTimeSec;
      const sourceDuration = sourceDurationMap.get(current.id) ?? 0;

      // Can the source cover the merged duration from current trimStart?
      if (current.trimStartSec + mergedDuration <= sourceDuration) {
        current.durationSec = mergedDuration;
        i++;
      } else if (mergedDuration <= sourceDuration) {
        // Reset trim to start of source
        current.trimStartSec = 0;
        current.durationSec = mergedDuration;
        i++;
      } else {
        // Source too short to merge — stop merging
        break;
      }
    }

    result.push(current);
    i++;
  }

  return result;
}

/**
 * Convert scheduled clips to Remotion Scene format.
 *
 * Consecutive clips from the same asset get `transition: 'none'` to avoid
 * visible dips if they couldn't be merged by the scheduler.
 */
export function scheduledClipsToScenes(
  scheduledClips: ScheduledBRollClip[],
  fps: number,
  clipLookup?: Map<string, BRollClip>
): Array<{
  id: string;
  clipUrl: string;
  type: 'b-roll';
  trimStart: number;
  trimEnd: number;
  startFrame: number;
  durationInFrames: number;
  transition: 'fade' | 'none';
  mediaType?: 'video' | 'image';
  /**
   * Which side of a before/after pair this clip is, carried from the source
   * clip's `clipType`. The renderer branches on it — before/after labels
   * (b-roll-layer), the reveal layer, and the before-after-1 PiP + interstitial
   * + full-screen reveal all key off it, and every one of those was dead while
   * this went unset: `scenes.find(s => s.bRollType === 'before')` cannot match a
   * field nobody emits. `bRoll` is not a side, so it maps to undefined.
   */
  bRollType?: 'before' | 'after' | 'procedure';
}> {
  return scheduledClips.map((clip, index) => {
    const prevClip = index > 0 ? scheduledClips[index - 1] : null;
    const isSameAssetAsPrev = prevClip !== null && prevClip.id === clip.id;
    // Detect back-to-back clips: previous clip ends where this one starts (within 1 frame).
    // These need a hard cut, not a fade — fading in from opacity 0 over a black background
    // creates a visible black flash when there's no talking head underneath.
    const prevEndSec = prevClip
      ? prevClip.startTimeSec + prevClip.durationSec
      : Number.NEGATIVE_INFINITY;
    const isConsecutive = clip.startTimeSec - prevEndSec < 1 / fps;
    const sourceClip = clipLookup?.get(clip.id);

    return {
      // Use index suffix to prevent React key conflicts when same asset repeats
      id: `${clip.id}-${index}`,
      clipUrl: clip.url,
      type: 'b-roll' as const,
      trimStart: Math.round(clip.trimStartSec * fps),
      trimEnd: 0, // Not used for b-roll
      startFrame: Math.round(clip.startTimeSec * fps),
      durationInFrames: Math.round(clip.durationSec * fps),
      transition:
        isSameAssetAsPrev || isConsecutive
          ? ('none' as const)
          : ('fade' as const),
      mediaType: sourceClip?.mediaType,
      bRollType:
        sourceClip?.clipType && sourceClip.clipType !== 'bRoll'
          ? sourceClip.clipType
          : undefined,
    };
  });
}
