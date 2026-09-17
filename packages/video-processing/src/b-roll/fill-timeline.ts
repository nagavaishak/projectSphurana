/**
 * Fill Timeline
 *
 * Fills remaining timeline by cycling through clips with unused trim regions.
 * Extracted from the duplicated filling loops in scheduleBeatSyncedBRollClips
 * and scheduleBRollClips.
 */

import type { BRollClip, ScheduledBRollClip } from './b-roll-scheduler.js';
import {
  type UsedRegion,
  generateTrimStart,
  generateVariedDuration,
} from './clip-utilities.js';

export interface FillTimelineConfig {
  /** Minimum acceptable clip duration (clips shorter than this stop filling) */
  minClipDurationSec: number;
  /**
   * When set, clips are placed at this fixed duration (beat-synced mode).
   * When undefined, clips use varied durations between min/max.
   */
  fixedClipDurationSec?: number;
  /** Maximum clip duration (used with varied duration mode) */
  maxClipDurationSec?: number;
}

/**
 * Fill remaining timeline by cycling through clips.
 *
 * Each clip uses a different segment of the source (tracked by usedRegionsMap)
 * so the same footage never repeats. Stops when all clips are exhausted or
 * the remaining gap is too small.
 *
 * Mutates `usedRegionsMap` and `segmentCounterMap` to track used regions.
 * Returns new clips to append (does NOT include the already-scheduled clips).
 */
export function fillTimelineWithClips(input: {
  scheduled: ScheduledBRollClip[];
  availableEnd: number;
  sortedClips: BRollClip[];
  usedRegionsMap: Map<string, UsedRegion[]>;
  segmentCounterMap: Map<string, number>;
  config: FillTimelineConfig;
}): ScheduledBRollClip[] {
  const {
    scheduled,
    availableEnd,
    sortedClips,
    usedRegionsMap,
    segmentCounterMap,
    config,
  } = input;
  const { minClipDurationSec, fixedClipDurationSec, maxClipDurationSec } =
    config;

  if (scheduled.length === 0 || sortedClips.length === 0) return [];

  const newClips: ScheduledBRollClip[] = [];

  // Fill from the clips NOT yet on screen first.
  //
  // This walked `sortedClips` from index 0, so a video that had already shown
  // clips 1-3 filled its tail by going back to clip 1 — while clips 4-8 sat
  // unused. Measured after the supply fix landed: 8 distinct clips reached the
  // renderer and beat-synced still produced 6 scenes from 5, and 4 from 3.
  //
  // Different trim regions were never the point. The docstring's claim that
  // "the same footage never repeats" is true and beside it: the complaint is
  // that the same CLIP comes back, which a viewer reads as a loop whichever
  // second of it plays.
  //
  // Unused clips first, in order; then the rest, so a genuinely long timeline
  // still fills rather than cutting to black.
  const alreadyShown = new Set(scheduled.map((c) => c.id));
  const fillOrder = [
    ...sortedClips.filter((c) => !alreadyShown.has(c.id)),
    ...sortedClips.filter((c) => alreadyShown.has(c.id)),
  ];
  let fillIndex = 0;
  let exhaustedCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const lastClip =
      newClips.length > 0
        ? newClips[newClips.length - 1]
        : scheduled[scheduled.length - 1];
    const lastEnd = lastClip.startTimeSec + lastClip.durationSec;
    const remaining = availableEnd - lastEnd;

    if (remaining < minClipDurationSec) break;

    const clip = fillOrder[fillIndex % fillOrder.length];

    // Determine duration for this fill clip
    let effectiveDuration: number;
    if (fixedClipDurationSec !== undefined) {
      effectiveDuration = Math.min(fixedClipDurationSec, remaining);
    } else {
      const duration = generateVariedDuration(
        minClipDurationSec,
        maxClipDurationSec ?? minClipDurationSec * 2,
        clip.sourceDurationSec
      );
      effectiveDuration = Math.min(duration, remaining);
    }

    if (effectiveDuration < minClipDurationSec) break;

    const usedRegions = usedRegionsMap.get(clip.id) || [];
    const counter = segmentCounterMap.get(clip.id) || 0;

    // Check if this clip has enough unused source left for another segment
    const totalUsed = usedRegions.reduce((sum, r) => sum + r.duration, 0);
    if (totalUsed + effectiveDuration > clip.sourceDurationSec) {
      fillIndex++;
      exhaustedCount++;
      if (exhaustedCount >= sortedClips.length) break;
      continue;
    }

    const trimStart = generateTrimStart(
      clip.sourceDurationSec,
      effectiveDuration,
      clip.actionSegments,
      usedRegions,
      counter
    );

    // Guard: don't exceed source duration (would cause last-frame freeze)
    if (trimStart + effectiveDuration > clip.sourceDurationSec + 0.1) {
      fillIndex++;
      exhaustedCount++;
      if (exhaustedCount >= sortedClips.length) break;
      continue;
    }
    exhaustedCount = 0;

    usedRegions.push({ start: trimStart, duration: effectiveDuration });
    usedRegionsMap.set(clip.id, usedRegions);
    segmentCounterMap.set(clip.id, counter + 1);

    newClips.push({
      id: clip.id,
      url: clip.url,
      startTimeSec: lastEnd,
      durationSec: effectiveDuration,
      trimStartSec: trimStart,
    });

    fillIndex++;
  }

  return newClips;
}
