export {
  scheduleBRollClips,
  type BRollClip,
  type ScheduledBRollClip,
  type SchedulerConfig,
} from './b-roll-scheduler.js';

export { scheduledClipsToScenes } from './scene-converter.js';

export {
  generateVariedDuration,
  generateVariedGap,
  generateTrimStart,
  overlapsUsedRegion,
  pickTrimStartFromSegments,
  sortClipsByType,
  computeEvenSlotIndices,
  OVERLAP_THRESHOLD,
  ROUNDING_PRECISION,
  FALLBACK_TRIM_FACTOR,
  type UsedRegion,
} from './clip-utilities.js';

export { mergeConsecutiveSameAssetClips } from './scene-converter.js';

export { computeGridPoints } from './compute-grid-points.js';

export {
  fillTimelineWithClips,
  type FillTimelineConfig,
} from './fill-timeline.js';
