import { describe, expect, it } from 'vitest';
import type { BRollClip, ScheduledBRollClip } from './b-roll-scheduler.js';
import {
  mergeConsecutiveSameAssetClips,
  scheduledClipsToScenes,
} from './scene-converter.js';

describe('mergeConsecutiveSameAssetClips', () => {
  const sourceClips: BRollClip[] = [
    { id: 'a', url: 'a.mp4', sourceDurationSec: 60, order: 0 },
    { id: 'b', url: 'b.mp4', sourceDurationSec: 60, order: 1 },
  ];

  it('returns input unchanged when 0 or 1 clips', () => {
    expect(mergeConsecutiveSameAssetClips([], sourceClips)).toEqual([]);
    const single: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    expect(mergeConsecutiveSameAssetClips(single, sourceClips)).toEqual(single);
  });

  it('merges consecutive same-asset clips into one', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 3,
      },
    ];
    const result = mergeConsecutiveSameAssetClips(scheduled, sourceClips);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('a');
    expect(result[0].startTimeSec).toBe(0);
    expect(result[0].durationSec).toBe(5); // 0 to (3+2)
    expect(result[0].trimStartSec).toBe(0); // Keeps first trim
  });

  it('does not merge clips from different assets', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'b',
        url: 'b.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    const result = mergeConsecutiveSameAssetClips(scheduled, sourceClips);
    expect(result.length).toBe(2);
  });

  it('resets trim to 0 when source cannot cover from original trim', () => {
    const shortSource: BRollClip[] = [
      { id: 'short', url: 's.mp4', sourceDurationSec: 8, order: 0 },
    ];
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'short',
        url: 's.mp4',
        startTimeSec: 0,
        durationSec: 3,
        trimStartSec: 4,
      },
      {
        id: 'short',
        url: 's.mp4',
        startTimeSec: 4,
        durationSec: 3,
        trimStartSec: 5,
      },
    ];
    // Merged duration = 7, trim at 4 + 7 = 11 > 8, but 7 <= 8 so trim resets to 0
    const result = mergeConsecutiveSameAssetClips(scheduled, shortSource);
    expect(result.length).toBe(1);
    expect(result[0].trimStartSec).toBe(0);
    expect(result[0].durationSec).toBe(7);
  });

  it('stops merging when source too short for combined duration', () => {
    const tinySource: BRollClip[] = [
      { id: 'tiny', url: 't.mp4', sourceDurationSec: 3, order: 0 },
    ];
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'tiny',
        url: 't.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'tiny',
        url: 't.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    // Merged duration = 5 > 3, can't merge
    const result = mergeConsecutiveSameAssetClips(scheduled, tinySource);
    expect(result.length).toBe(2);
  });

  it('merges three consecutive same-asset clips', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 3,
      },
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 6,
        durationSec: 2,
        trimStartSec: 6,
      },
    ];
    const result = mergeConsecutiveSameAssetClips(scheduled, sourceClips);
    expect(result.length).toBe(1);
    expect(result[0].durationSec).toBe(8); // 0 to (6+2)
  });
});

describe('scheduledClipsToScenes', () => {
  it('converts clips to scene format with correct frame calculations', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'clip-0',
        url: 'c0.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 1,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);

    expect(scenes.length).toBe(1);
    expect(scenes[0].id).toBe('clip-0-0');
    expect(scenes[0].clipUrl).toBe('c0.mp4');
    expect(scenes[0].type).toBe('b-roll');
    expect(scenes[0].trimStart).toBe(30); // 1 * 30
    expect(scenes[0].trimEnd).toBe(0);
    expect(scenes[0].startFrame).toBe(90); // 3 * 30
    expect(scenes[0].durationInFrames).toBe(60); // 2 * 30
    expect(scenes[0].transition).toBe('fade');
  });

  it('sets fade transition for clips from different assets', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'b',
        url: 'b.mp4',
        startTimeSec: 7,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);
    expect(scenes[0].transition).toBe('fade');
    expect(scenes[1].transition).toBe('fade');
  });

  it('sets none transition for consecutive same-asset clips', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'same',
        url: 's.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'same',
        url: 's.mp4',
        startTimeSec: 7,
        durationSec: 2,
        trimStartSec: 2,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);
    expect(scenes[0].transition).toBe('fade');
    expect(scenes[1].transition).toBe('none');
  });

  it('sets none transition for back-to-back clips (within 1 frame)', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'a',
        url: 'a.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'b',
        url: 'b.mp4',
        startTimeSec: 2,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);
    expect(scenes[1].transition).toBe('none'); // Back-to-back → no fade
  });

  it('generates unique scene IDs for same-asset clips', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'same',
        url: 's.mp4',
        startTimeSec: 0,
        durationSec: 5,
        trimStartSec: 0,
      },
      {
        id: 'same',
        url: 's.mp4',
        startTimeSec: 5,
        durationSec: 5,
        trimStartSec: 5,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);
    expect(scenes[0].id).toBe('same-0');
    expect(scenes[1].id).toBe('same-1');
  });

  it('includes mediaType from clipLookup', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'img',
        url: 'photo.jpg',
        startTimeSec: 0,
        durationSec: 3,
        trimStartSec: 0,
      },
    ];
    const lookup = new Map<string, BRollClip>([
      [
        'img',
        {
          id: 'img',
          url: 'photo.jpg',
          sourceDurationSec: 10,
          order: 0,
          mediaType: 'image',
        },
      ],
    ]);
    const scenes = scheduledClipsToScenes(scheduled, 30, lookup);
    expect(scenes[0].mediaType).toBe('image');
  });

  it('returns undefined mediaType when no clipLookup', () => {
    const scheduled: ScheduledBRollClip[] = [
      {
        id: 'c',
        url: 'c.mp4',
        startTimeSec: 0,
        durationSec: 2,
        trimStartSec: 0,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);
    expect(scenes[0].mediaType).toBeUndefined();
  });

  it('handles empty input', () => {
    expect(scheduledClipsToScenes([], 30)).toEqual([]);
  });
});
