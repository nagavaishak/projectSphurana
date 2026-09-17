import {
  type BRollClip,
  type ScheduledBRollClip,
  generateTrimStart,
} from '@borradh-workspace/video-processing/b-roll';

/**
 * Schedule b-roll for the templates whose scene count comes from COPY rather
 * than from footage — improves (one scene per item), fade-benefits (one per
 * line), step-timer (one per step).
 *
 * Those templates each hand-rolled the same two lines:
 *
 *     const src = bRollClips[i % bRollClips.length];
 *     trimStartSec: 0,
 *
 * which is wrong twice over. `%` WRAPS, so three clips over four scenes plays
 * 0,1,2,0 — the opening shot returns as the closing shot, which is the defect a
 * botox render shipped. And a fixed `trimStartSec: 0` means the reuse shows the
 * exact same seconds of footage, so it reads as a loop rather than as more of
 * the treatment.
 *
 * Both were avoidable: the overrides begin with `scheduledBRoll.length = 0`,
 * discarding a schedule the b-roll scheduler had already built with varied trim
 * regions per clip. This puts that machinery back.
 *
 * TWO CHANGES:
 *
 * 1. MONOTONIC assignment, `floor(slot * clips / slots)` instead of `%`. A clip
 *    is never re-introduced after a later one has been shown, so the video
 *    always progresses. 4 scenes / 3 clips → 0,0,1,2.
 *
 * 2. VARIED TRIM via `generateTrimStart`, tracking used regions per clip. When
 *    a clip covers two scenes they show DIFFERENT seconds of it — the second
 *    reads as another moment of the same treatment rather than a replay. This
 *    is the same call the scheduler makes in its own recycling path.
 *
 * WHAT THIS DOES NOT DO: guarantee each clip appears once. It cannot. Scene
 * count is set by the copy — `ImprovesLayer` and friends map text 1:1 onto
 * scenes so the words change exactly when the picture cuts — so merging
 * consecutive scenes would desynchronise the text, and dropping scenes would
 * drop copy. With fewer clips than lines, reuse is structural. The fix makes
 * reuse look intentional instead of broken; the real cure is more footage for
 * the service (see the acquisition list, ENG-670).
 */
export function scheduleCopyDrivenBRoll(
  bRollClips: BRollClip[],
  slots: Array<{ startTimeSec: number; durationSec: number }>
): ScheduledBRollClip[] {
  if (bRollClips.length === 0 || slots.length === 0) return [];

  const usedRegions = new Map<
    string,
    Array<{ start: number; duration: number }>
  >();
  const counters = new Map<string, number>();
  const out: ScheduledBRollClip[] = [];

  for (const [slot, { startTimeSec, durationSec }] of slots.entries()) {
    const idx = Math.min(
      Math.floor((slot * bRollClips.length) / slots.length),
      bRollClips.length - 1
    );
    const clip = bRollClips[idx];
    if (!clip) continue;

    const regions = usedRegions.get(clip.id) ?? [];
    const counter = counters.get(clip.id) ?? 0;
    const trimStartSec = generateTrimStart(
      clip.sourceDurationSec,
      durationSec,
      clip.actionSegments,
      regions,
      counter
    );
    regions.push({ start: trimStartSec, duration: durationSec });
    usedRegions.set(clip.id, regions);
    counters.set(clip.id, counter + 1);

    out.push({
      id: clip.id,
      url: clip.url,
      startTimeSec,
      durationSec,
      trimStartSec,
    });
  }

  return out;
}
