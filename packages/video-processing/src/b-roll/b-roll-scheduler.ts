/**
 * B-Roll Scheduler
 *
 * Distributes b-roll clips across the talking head timeline with
 * varying durations to maintain viewer engagement.
 *
 * Flexible design that works with any template type:
 * - Before/After transformations
 * - Client testimonials
 * - Tips & tutorials
 * - Behind the scenes
 * - Product demos
 *
 * The scheduler intelligently distributes clips throughout the video,
 * with gaps to show the talking head periodically.
 */

import {
  type UsedRegion,
  computeEvenSlotIndices,
  generateTrimStart,
  generateVariedDuration,
  generateVariedGap,
  sortClipsByType,
} from './clip-utilities.js';
import { computeGridPoints } from './compute-grid-points.js';
import { fillTimelineWithClips } from './fill-timeline.js';
import { mergeConsecutiveSameAssetClips } from './scene-converter.js';

export type { UsedRegion } from './clip-utilities.js';
export { scheduledClipsToScenes } from './scene-converter.js';

export interface BRollClip {
  id: string;
  url: string;
  /** Duration of the source clip in seconds */
  sourceDurationSec: number;
  /** Display order preference */
  order: number;
  /** Clip type for template-specific ordering */
  clipType?: 'before' | 'after' | 'bRoll' | 'procedure';
  /** Media type - video (default) or image (still photo rendered for fixed duration) */
  mediaType?: 'video' | 'image';
  /** Action segments from AI analysis (used for smart trim selection) */
  actionSegments?: import('../vision/types.js').ActionSegment[];
}

export interface ScheduledBRollClip {
  id: string;
  url: string;
  /** Start time in the timeline (seconds) */
  startTimeSec: number;
  /** Duration to show this clip (seconds) */
  durationSec: number;
  /** Trim start from source (seconds) */
  trimStartSec: number;
}

export interface SchedulerConfig {
  /** Total talking head duration in seconds */
  totalDurationSec: number;
  /** Seconds of talking head intro before first b-roll */
  introSec?: number;
  /** Seconds before outro overlay where we stop b-roll */
  outroBufferSec?: number;
  /** Minimum clip duration in seconds */
  minClipDurationSec?: number;
  /** Maximum clip duration in seconds */
  maxClipDurationSec?: number;
  /** Gap between clips in seconds (shows talking head) */
  gapBetweenClipsSec?: number;
  /** Frames per second for frame calculations */
  fps?: number;
  /** Target percentage of timeline to fill with b-roll (0-1) */
  targetCoverage?: number;
  /** Beats per minute of the selected music track (enables beat-synced mode) */
  bpm?: number;
  /** How many beats per edit point (e.g., 2 = cut every 2 beats, 4 = every 4 beats) */
  beatsPerEdit?: number;
  /** When true, reuse clips cyclically to fill the full timeline (for AI voiceover where there's no talking head underneath) */
  recycleClips?: boolean;
}

const DEFAULT_CONFIG: Required<
  Omit<
    SchedulerConfig,
    'totalDurationSec' | 'bpm' | 'beatsPerEdit' | 'recycleClips'
  >
> = {
  introSec: 3,
  outroBufferSec: 3,
  minClipDurationSec: 2,
  maxClipDurationSec: 5,
  gapBetweenClipsSec: 1.5,
  fps: 30,
  targetCoverage: 0.6, // Fill ~60% of available time with b-roll
};

/**
 * Schedule b-roll clips aligned to a beat grid derived from BPM and beatsPerEdit.
 *
 * Builds a grid of edit points across the available timeline, then distributes
 * clips onto grid slots. ~25% of clips span 2 slots for variety.
 *
 * When recycleClips is true (AI voiceover mode), clips are reused cyclically
 * to fill the full timeline with no black gaps.
 */
function scheduleBeatSyncedBRollClips(
  clips: BRollClip[],
  config: SchedulerConfig & { bpm: number; beatsPerEdit: number }
): ScheduledBRollClip[] {
  const {
    totalDurationSec,
    bpm,
    beatsPerEdit,
    introSec = DEFAULT_CONFIG.introSec,
    outroBufferSec = DEFAULT_CONFIG.outroBufferSec,
    gapBetweenClipsSec = DEFAULT_CONFIG.gapBetweenClipsSec,
    targetCoverage = DEFAULT_CONFIG.targetCoverage,
    recycleClips = false,
  } = config;

  const availableStart = introSec;
  const availableEnd = totalDurationSec - outroBufferSec;
  const availableDuration = availableEnd - availableStart;
  // No gaps when recycling or explicitly set to 0 (e.g., no talking head underneath)
  const noGaps = recycleClips || gapBetweenClipsSec === 0;

  if (availableDuration < 1.5 || clips.length === 0) {
    return [];
  }

  // Compute edit interval and clamp to [1.5s, 5s]
  const rawInterval = (60 / bpm) * beatsPerEdit;
  const editIntervalSec = Math.max(1.5, Math.min(5, rawInterval));

  const gridPoints = computeGridPoints(
    availableStart,
    availableEnd,
    editIntervalSec
  );

  if (gridPoints.length === 0) {
    return [];
  }

  // Determine how many grid slots to fill
  const totalSlots = gridPoints.length;
  const targetFilledSlots = Math.max(
    1,
    Math.round(totalSlots * targetCoverage)
  );

  // Sort clips by type priority (before → bRoll → after)
  const sortedClips = sortClipsByType(clips);

  // When recycling, fill all target slots by cycling through clips
  // When not recycling, cap at available clip count
  const clipsToPlace = recycleClips
    ? targetFilledSlots
    : Math.min(sortedClips.length, targetFilledSlots);
  if (clipsToPlace === 0) return [];

  // When no gaps desired (no talking head underneath), place clips on
  // consecutive slots so they play back-to-back. Otherwise spread them
  // evenly across the timeline to show talking head in the gaps.
  const slotIndices = noGaps
    ? Array.from({ length: clipsToPlace }, (_, i) => i)
    : computeEvenSlotIndices(clipsToPlace, totalSlots);

  const scheduled: ScheduledBRollClip[] = [];
  // Track used trim regions per clip ID to avoid repeating the same section
  const usedRegionsMap = new Map<string, UsedRegion[]>();
  const segmentCounterMap = new Map<string, number>();

  for (let i = 0; i < slotIndices.length; i++) {
    const slotIdx = slotIndices[i];
    // Cycle through clips when recycling
    const clip = sortedClips[i % sortedClips.length];
    const startTime = gridPoints[slotIdx];

    // ~25% chance of spanning 2 slots if source duration allows and next slot isn't already taken
    const nextSlotTaken =
      i + 1 < slotIndices.length && slotIndices[i + 1] === slotIdx + 1;
    const canSpanTwo =
      !nextSlotTaken &&
      slotIdx + 1 < totalSlots &&
      clip.sourceDurationSec >= editIntervalSec * 2;
    const spanTwo = canSpanTwo && Math.random() < 0.25;

    const durationSec = spanTwo ? editIntervalSec * 2 : editIntervalSec;

    // Ensure clip fits within available timeline
    if (startTime + durationSec > availableEnd) break;

    const usedRegions = usedRegionsMap.get(clip.id) || [];
    const counter = segmentCounterMap.get(clip.id) || 0;

    const trimStart = generateTrimStart(
      clip.sourceDurationSec,
      durationSec,
      clip.actionSegments,
      usedRegions,
      counter
    );

    // Record this region as used
    usedRegions.push({ start: trimStart, duration: durationSec });
    usedRegionsMap.set(clip.id, usedRegions);
    segmentCounterMap.set(clip.id, counter + 1);

    scheduled.push({
      id: clip.id,
      url: clip.url,
      startTimeSec: startTime,
      durationSec,
      trimStartSec: trimStart,
    });
  }

  if (noGaps) {
    // Fill remaining timeline using extracted fill-timeline module
    const fillClips = fillTimelineWithClips({
      scheduled,
      availableEnd,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: {
        minClipDurationSec: editIntervalSec * 0.5,
        fixedClipDurationSec: editIntervalSec,
      },
    });
    scheduled.push(...fillClips);
  } else if (scheduled.length > 0) {
    // Talking head visible underneath — just extend last clip to fill any small
    // remaining gap. If the source is shorter, Remotion freezes on the last frame
    // which is acceptable since the talking head is the primary visual.
    const lastClip = scheduled[scheduled.length - 1];
    const lastClipEnd = lastClip.startTimeSec + lastClip.durationSec;
    if (lastClipEnd < availableEnd) {
      lastClip.durationSec += availableEnd - lastClipEnd;
    }
  }

  // Skip merge when recycling — each clip's trimStart was carefully picked
  // from different action segments. Merging would override those selections
  // with one continuous playback region. scheduledClipsToScenes already
  // handles back-to-back same-asset clips with transition: 'none'.
  if (recycleClips) return scheduled;

  return mergeConsecutiveSameAssetClips(scheduled, clips);
}

/**
 * Schedule b-roll clips across the talking head timeline
 *
 * When `bpm` and `beatsPerEdit` are provided, uses beat-synced mode where
 * transitions land on beat boundaries. Otherwise falls back to the
 * varied-duration scheduler.
 *
 * Distributes clips evenly throughout the available timeline with:
 * - Intro period (talking head only)
 * - B-roll clips with varied durations
 * - Gaps between clips (showing talking head)
 * - Outro buffer for overlay
 *
 * Clip ordering based on clipType:
 * - 'before': scheduled first (after intro)
 * - 'bRoll' (or undefined): distributed in middle
 * - 'after': scheduled last (before outro)
 */
export function scheduleBRollClips(
  clips: BRollClip[],
  config: SchedulerConfig
): ScheduledBRollClip[] {
  // Branch: beat-synced mode when BPM data is available
  if (config.bpm && config.beatsPerEdit) {
    return scheduleBeatSyncedBRollClips(clips, {
      ...config,
      bpm: config.bpm,
      beatsPerEdit: config.beatsPerEdit,
    });
  }
  const {
    totalDurationSec,
    introSec = DEFAULT_CONFIG.introSec,
    outroBufferSec = DEFAULT_CONFIG.outroBufferSec,
    minClipDurationSec = DEFAULT_CONFIG.minClipDurationSec,
    maxClipDurationSec = DEFAULT_CONFIG.maxClipDurationSec,
    gapBetweenClipsSec = DEFAULT_CONFIG.gapBetweenClipsSec,
    targetCoverage = DEFAULT_CONFIG.targetCoverage,
  } = config;

  // Available timeline for b-roll (between intro and outro)
  const availableStart = introSec;
  const availableEnd = totalDurationSec - outroBufferSec;
  const availableDuration = availableEnd - availableStart;

  if (availableDuration < minClipDurationSec || clips.length === 0) {
    // Not enough time for b-roll or no clips
    return [];
  }

  // Sort clips by clipType (before → bRoll → after), then by order within each type
  const sortedClips = sortClipsByType(clips);

  const recycleClips = config.recycleClips ?? false;
  // No gaps when recycling (no talking head) or explicitly set to 0
  const noGaps = recycleClips || gapBetweenClipsSec === 0;

  // Calculate target b-roll time
  const targetBRollTime = availableDuration * targetCoverage;
  const avgClipDuration = (minClipDurationSec + maxClipDurationSec) / 2;

  // Estimate how many clips we can fit
  // When recycling, don't cap at sortedClips.length
  const estimatedFromTime = Math.ceil(targetBRollTime / avgClipDuration);
  const estimatedClipsCount = recycleClips
    ? estimatedFromTime
    : Math.min(sortedClips.length, estimatedFromTime);

  const scheduled: ScheduledBRollClip[] = [];
  let currentTime = availableStart;
  // Track used trim regions per clip ID to avoid repeating the same section
  const usedRegionsMap = new Map<string, UsedRegion[]>();
  const segmentCounterMap = new Map<string, number>();

  // Calculate spacing - distribute clips evenly across available time
  const totalClipTime = estimatedClipsCount * avgClipDuration;
  const totalGapTime = availableDuration - totalClipTime;
  const gapCount = estimatedClipsCount + 1; // gaps before, between, and after clips
  const avgGap = noGaps
    ? 0
    : Math.max(gapBetweenClipsSec, totalGapTime / gapCount);

  // Add initial gap (after intro) — skip when no gaps desired
  if (!noGaps) {
    currentTime += generateVariedGap(avgGap * 0.5); // Shorter initial gap
  }

  for (let i = 0; i < estimatedClipsCount; i++) {
    // Cycle through clips when recycling
    const clip = sortedClips[i % sortedClips.length];

    // Check if we have room for this clip
    if (currentTime >= availableEnd - minClipDurationSec) break;

    // Generate varied duration
    const duration = generateVariedDuration(
      minClipDurationSec,
      maxClipDurationSec,
      clip.sourceDurationSec
    );

    // Ensure we don't exceed available end
    const effectiveDuration = Math.min(duration, availableEnd - currentTime);

    if (effectiveDuration < minClipDurationSec) break;

    // Generate trim start (prefers action segments if available, avoids used regions)
    const usedRegions = usedRegionsMap.get(clip.id) || [];
    const counter = segmentCounterMap.get(clip.id) || 0;

    const trimStart = generateTrimStart(
      clip.sourceDurationSec,
      effectiveDuration,
      clip.actionSegments,
      usedRegions,
      counter
    );

    // Record this region as used
    usedRegions.push({ start: trimStart, duration: effectiveDuration });
    usedRegionsMap.set(clip.id, usedRegions);
    segmentCounterMap.set(clip.id, counter + 1);

    scheduled.push({
      id: clip.id,
      url: clip.url,
      startTimeSec: currentTime,
      durationSec: effectiveDuration,
      trimStartSec: trimStart,
    });

    // Move to next position — no gap when recycling or gapBetweenClipsSec === 0
    currentTime += effectiveDuration + (noGaps ? 0 : generateVariedGap(avgGap));
  }

  // Fill remaining timeline using extracted fill-timeline module
  const fillClips = fillTimelineWithClips({
    scheduled,
    availableEnd,
    sortedClips,
    usedRegionsMap,
    segmentCounterMap,
    config: { minClipDurationSec, maxClipDurationSec },
  });
  scheduled.push(...fillClips);

  // Skip merge when recycling — each clip's trimStart was carefully picked
  // from different action segments. Merging destroys those selections.
  if (recycleClips) return scheduled;

  return mergeConsecutiveSameAssetClips(scheduled, sortedClips);
}
