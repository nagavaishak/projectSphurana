/**
 * B-Roll Clip Utilities
 *
 * Pure utility functions for clip scheduling: duration generation,
 * trim selection, overlap detection, and clip sorting.
 */

import type { ActionSegment } from '../vision/types.js';
import type { BRollClip } from './b-roll-scheduler.js';

/** A region of a source clip that has already been used */
export interface UsedRegion {
  start: number;
  duration: number;
}

// Named constants for magic numbers used in trim/overlap calculations
export const OVERLAP_THRESHOLD = 0.5;
export const ROUNDING_PRECISION = 0.1;
export const FALLBACK_TRIM_FACTOR = 0.8;

/**
 * Generate a varied duration for a clip
 * Uses a weighted random to favor middle durations for natural pacing
 */
export function generateVariedDuration(
  minSec: number,
  maxSec: number,
  sourceMaxSec: number
): number {
  // Don't exceed source duration
  const effectiveMax = Math.min(maxSec, sourceMaxSec);
  const effectiveMin = Math.min(minSec, effectiveMax);

  // Weighted random: favor durations in the middle range
  const range = effectiveMax - effectiveMin;
  const random = Math.random();

  // Use a bell curve-ish distribution (average of 3 random values)
  const weighted = (random + Math.random() + Math.random()) / 3;
  const duration = effectiveMin + weighted * range;

  // Round to 0.5 second increments for cleaner editing
  return Math.round(duration * 2) / 2;
}

/**
 * Check whether a candidate trim region overlaps significantly with already-used regions.
 * Returns true if > 50% of the candidate overlaps with any single used region.
 */
export function overlapsUsedRegion(
  candidateStart: number,
  candidateDuration: number,
  usedRegions: UsedRegion[]
): boolean {
  for (const region of usedRegions) {
    const overlapStart = Math.max(candidateStart, region.start);
    const overlapEnd = Math.min(
      candidateStart + candidateDuration,
      region.start + region.duration
    );
    const overlap = Math.max(0, overlapEnd - overlapStart);
    if (overlap > candidateDuration * OVERLAP_THRESHOLD) return true;
  }
  return false;
}

/**
 * Pick a trim start point from action segments, cycling through segments
 * to avoid repeating the same section when a clip is reused.
 * Returns null if no suitable segment is found.
 */
export function pickTrimStartFromSegments(
  segments: ActionSegment[],
  clipDurationSec: number,
  sourceDurationSec: number,
  usedRegions: UsedRegion[],
  segmentCounter: number
): number | null {
  // Filter to 'action' segments
  const actionSegs = segments.filter((s) => s.label === 'action');
  if (actionSegs.length === 0) return null;

  // Segments long enough to fit the clip
  const fittingSegs = actionSegs.filter(
    (s) => s.endSec - s.startSec >= clipDurationSec
  );

  if (fittingSegs.length > 0) {
    // Round-robin through fitting segments instead of weighted random
    const segIndex = segmentCounter % fittingSegs.length;
    const seg = fittingSegs[segIndex];

    // Pick a point within this segment ensuring clip fits
    const maxStart = seg.endSec - clipDurationSec;
    const trimStart = seg.startSec + Math.random() * (maxStart - seg.startSec);
    const clamped = Math.min(trimStart, sourceDurationSec - clipDurationSec);
    const result =
      Math.round(Math.max(0, clamped) / ROUNDING_PRECISION) *
      ROUNDING_PRECISION;

    // If it overlaps used regions, try the next segment
    if (overlapsUsedRegion(result, clipDurationSec, usedRegions)) {
      for (let attempt = 1; attempt < fittingSegs.length; attempt++) {
        const altSeg = fittingSegs[(segIndex + attempt) % fittingSegs.length];
        const altMaxStart = altSeg.endSec - clipDurationSec;
        const altTrimStart =
          altSeg.startSec + Math.random() * (altMaxStart - altSeg.startSec);
        const altClamped = Math.min(
          altTrimStart,
          sourceDurationSec - clipDurationSec
        );
        const altResult =
          Math.round(Math.max(0, altClamped) / ROUNDING_PRECISION) *
          ROUNDING_PRECISION;
        if (!overlapsUsedRegion(altResult, clipDurationSec, usedRegions)) {
          return altResult;
        }
      }
    }

    return result;
  }

  // No segment long enough — use the longest action segment and start at its beginning
  const longest = actionSegs.reduce((best, seg) =>
    seg.endSec - seg.startSec > best.endSec - best.startSec ? seg : best
  );
  return (
    Math.round(Math.max(0, longest.startSec) / ROUNDING_PRECISION) *
    ROUNDING_PRECISION
  );
}

/**
 * Generate a random trim start point within the source clip.
 * When action segments are available, prefers action-rich portions.
 * Avoids regions that have already been used for this clip.
 */
export function generateTrimStart(
  sourceDurationSec: number,
  clipDurationSec: number,
  actionSegments?: ActionSegment[],
  usedRegions: UsedRegion[] = [],
  segmentCounter = 0
): number {
  // Try action-segment-aware selection first
  if (actionSegments && actionSegments.length > 0) {
    const segmentPick = pickTrimStartFromSegments(
      actionSegments,
      clipDurationSec,
      sourceDurationSec,
      usedRegions,
      segmentCounter
    );
    if (segmentPick !== null) return segmentPick;
  }

  // Fallback: random trim start avoiding used regions
  const maxTrimStart = Math.max(0, sourceDurationSec - clipDurationSec);
  if (maxTrimStart === 0) return 0;

  // Try up to 5 random positions to find one that doesn't overlap
  for (let attempt = 0; attempt < 5; attempt++) {
    const trimStart = Math.random() * maxTrimStart * FALLBACK_TRIM_FACTOR;
    const rounded =
      Math.round(trimStart / ROUNDING_PRECISION) * ROUNDING_PRECISION;
    if (!overlapsUsedRegion(rounded, clipDurationSec, usedRegions)) {
      return rounded;
    }
  }

  // If source is long enough, try evenly-spaced positions
  if (usedRegions.length > 0 && maxTrimStart > clipDurationSec) {
    const spacing = maxTrimStart / (usedRegions.length + 1);
    const candidate =
      spacing * (usedRegions.length % Math.floor(maxTrimStart / spacing + 1));
    const rounded =
      Math.round(Math.min(candidate, maxTrimStart) / ROUNDING_PRECISION) *
      ROUNDING_PRECISION;
    if (!overlapsUsedRegion(rounded, clipDurationSec, usedRegions)) {
      return rounded;
    }
  }

  // Last resort: use a position based on counter to spread across source
  const stepSize = maxTrimStart / Math.max(1, usedRegions.length + 1);
  const fallback = (segmentCounter * stepSize) % maxTrimStart;
  return Math.round(fallback / ROUNDING_PRECISION) * ROUNDING_PRECISION;
}

/**
 * Generate a varied gap duration for natural pacing
 */
export function generateVariedGap(baseGapSec: number): number {
  // Vary gap by +-30%
  const variation = (Math.random() - 0.5) * 0.6 * baseGapSec;
  return Math.max(0.5, baseGapSec + variation);
}

/**
 * Sort clips by clipType priority:
 * 1. before: first position
 * 2. procedure: after before, before generic b-roll
 * 3. bRoll: middle positions (by order)
 * 4. after: last position
 */
export function sortClipsByType(clips: BRollClip[]): BRollClip[] {
  const beforeClips = clips.filter((c) => c.clipType === 'before');
  const procedureClips = clips
    .filter((c) => c.clipType === 'procedure')
    .sort((a, b) => a.order - b.order);
  const bRollClips = clips
    .filter((c) => c.clipType === 'bRoll' || !c.clipType)
    .sort((a, b) => a.order - b.order);
  const afterClips = clips.filter((c) => c.clipType === 'after');

  return [...beforeClips, ...procedureClips, ...bRollClips, ...afterClips];
}

/**
 * Compute evenly-spaced slot indices for placing N items in M slots.
 * Returns indices spread across the full range [0, totalSlots).
 */
export function computeEvenSlotIndices(
  count: number,
  totalSlots: number
): number[] {
  if (count >= totalSlots) {
    return Array.from({ length: totalSlots }, (_, i) => i);
  }
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.floor((i * totalSlots) / count));
  }
  return indices;
}
