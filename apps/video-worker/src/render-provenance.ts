import type { ScheduledBRollClip } from '@borradh-workspace/video-processing/b-roll';

/**
 * Which scheduler produced the final clip list. There are four, they behave
 * differently, and until this was recorded the only way to find out which one
 * built a given video was to read all of them.
 */
export type SchedulerPath =
  | 'beat-synced'
  | 'improves'
  | 'fade-benefits'
  | 'step-timer';

export interface RenderStageProvenance {
  stage: 'render';
  scheduler: SchedulerPath;
  templateId?: string;
  variationId?: string;
  /** Clip ids that arrived from the plan, before any scheduling. */
  plannedClipIds: string[];
  /** Scenes actually scheduled, in play order. */
  sceneCount: number;
  /** Distinct clips across those scenes. Less than sceneCount means reuse. */
  distinctClipCount: number;
  /**
   * True when one clip fills two or more scenes AND at least two of those
   * scenes start from the same point in the source — i.e. the viewer sees the
   * same seconds twice. Reuse with different trim points is intentional and is
   * NOT flagged.
   */
  repeatsIdenticalFootage: boolean;
  /** Per scene, enough to reconstruct what was on screen and when. */
  scenes: Array<{
    id: string;
    startTimeSec: number;
    durationSec: number;
    trimStartSec: number;
  }>;
}

/**
 * Summarise the FINAL b-roll schedule for provenance.
 *
 * `content_generation_provenance` is written by `plan-video-detail` in the API
 * and records what was PLANNED. Every template override that reshapes the
 * schedule runs later, here in the worker. So a plan row can read
 * `clipAssetIds: [a, b, c]`, all distinct, while the video plays `a, b, c, a`.
 *
 * That gap is not theoretical. #703 removed clip repetition from selection, and
 * the plan rows went clean while renders still repeated — so the diagnostic
 * moved from "`clipsCycled: true`, at least a hint" to actively reassuring, and
 * the next duplicate was found by a person watching a video.
 *
 * The row this builds makes the defect queryable:
 *
 *     distinctClipCount < sceneCount        -> a clip fills more than one scene
 *     repeatsIdenticalFootage = true        -> and the same seconds are shown twice
 *
 * The first is often fine — with fewer clips than copy lines it is structural,
 * and `generateTrimStart` gives each scene a different segment. The second is
 * the actual defect.
 */
export function summariseRenderSchedule(args: {
  scheduler: SchedulerPath;
  templateId?: string;
  variationId?: string;
  plannedClipIds: string[];
  scheduled: ScheduledBRollClip[];
}): RenderStageProvenance {
  const { scheduler, templateId, variationId, plannedClipIds, scheduled } =
    args;

  const trimsById = new Map<string, number[]>();
  for (const s of scheduled) {
    const trims = trimsById.get(s.id) ?? [];
    trims.push(Math.round(s.trimStartSec * 100) / 100);
    trimsById.set(s.id, trims);
  }

  const repeatsIdenticalFootage = [...trimsById.values()].some(
    (trims) => trims.length > 1 && new Set(trims).size < trims.length
  );

  return {
    stage: 'render',
    scheduler,
    templateId,
    variationId,
    plannedClipIds,
    sceneCount: scheduled.length,
    distinctClipCount: trimsById.size,
    repeatsIdenticalFootage,
    scenes: scheduled.map((s) => ({
      id: s.id,
      startTimeSec: Math.round(s.startTimeSec * 100) / 100,
      durationSec: Math.round(s.durationSec * 100) / 100,
      trimStartSec: Math.round(s.trimStartSec * 100) / 100,
    })),
  };
}
