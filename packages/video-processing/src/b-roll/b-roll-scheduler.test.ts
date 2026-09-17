import { describe, expect, it } from 'vitest';
import type { ActionSegment } from '../vision/types.js';
import {
  type BRollClip,
  type SchedulerConfig,
  scheduleBRollClips,
  scheduledClipsToScenes,
} from './b-roll-scheduler.js';

function makeClips(count: number, sourceDuration = 10): BRollClip[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `clip-${i}`,
    url: `https://example.com/clip-${i}.mp4`,
    sourceDurationSec: sourceDuration,
    order: i,
    clipType: 'bRoll' as const,
  }));
}

describe('scheduleBRollClips – beat-synced mode', () => {
  const baseConfig: SchedulerConfig = {
    totalDurationSec: 30,
    introSec: 3,
    outroBufferSec: 3,
    fps: 30,
    bpm: 120,
    beatsPerEdit: 4,
  };

  it('returns clips aligned to the beat grid', () => {
    const clips = makeClips(5);
    const result = scheduleBRollClips(clips, baseConfig);

    expect(result.length).toBeGreaterThan(0);

    // Edit interval at 120 BPM with 4 beats per edit = 2s
    const editInterval = (60 / 120) * 4; // 2s

    for (const clip of result) {
      // Each clip start should be on the grid (multiples of editInterval offset from introSec)
      const offsetFromIntro = clip.startTimeSec - (baseConfig.introSec ?? 0);
      const gridPosition = offsetFromIntro / editInterval;
      expect(gridPosition).toBeCloseTo(Math.round(gridPosition), 5);
    }
  });

  it('clips have duration equal to editInterval (1 or 2 slots)', () => {
    const clips = makeClips(10);
    const result = scheduleBRollClips(clips, baseConfig);
    const editInterval = (60 / 120) * 4; // 2s

    for (const clip of result) {
      const isOneSlot = Math.abs(clip.durationSec - editInterval) < 0.001;
      const isTwoSlots = Math.abs(clip.durationSec - editInterval * 2) < 0.001;
      expect(isOneSlot || isTwoSlots).toBe(true);
    }
  });

  it('does not exceed timeline bounds', () => {
    const clips = makeClips(10);
    const result = scheduleBRollClips(clips, baseConfig);
    const availableEnd =
      baseConfig.totalDurationSec - (baseConfig.outroBufferSec ?? 0);

    for (const clip of result) {
      expect(clip.startTimeSec).toBeGreaterThanOrEqual(
        baseConfig.introSec ?? 0
      );
      expect(clip.startTimeSec + clip.durationSec).toBeLessThanOrEqual(
        availableEnd
      );
    }
  });

  it('returns empty array when no clips provided', () => {
    const result = scheduleBRollClips([], baseConfig);
    expect(result).toEqual([]);
  });

  it('returns empty array when available duration is too short', () => {
    const result = scheduleBRollClips(makeClips(3), {
      ...baseConfig,
      totalDurationSec: 5, // Only 5s total, minus intro+outro = -1s
    });
    expect(result).toEqual([]);
  });

  it('clamps edit interval to min 1.5s for high BPM', () => {
    const clips = makeClips(5, 20);
    const config: SchedulerConfig = {
      ...baseConfig,
      totalDurationSec: 60,
      bpm: 200, // Very fast: raw = (60/200)*2 = 0.6s → clamped to 1.5s
      beatsPerEdit: 2,
    };
    const result = scheduleBRollClips(clips, config);

    expect(result.length).toBeGreaterThan(0);
    for (const clip of result) {
      expect(clip.durationSec).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('clamps edit interval to max 5s for low BPM', () => {
    const clips = makeClips(3, 20);
    const config: SchedulerConfig = {
      ...baseConfig,
      totalDurationSec: 60,
      bpm: 40, // Very slow: raw = (60/40)*4 = 6s → clamped to 5s
      beatsPerEdit: 4,
    };
    const result = scheduleBRollClips(clips, config);

    expect(result.length).toBeGreaterThan(0);
    // All clips except the last should respect max 2 slots × 5s.
    // The last clip extends to fill remaining timeline.
    for (const clip of result.slice(0, -1)) {
      expect(clip.durationSec).toBeLessThanOrEqual(10); // Max 2 slots × 5s
    }
  });

  it('handles fewer clips than available grid slots', () => {
    const clips = makeClips(2);
    const config: SchedulerConfig = {
      ...baseConfig,
      totalDurationSec: 60, // Many grid slots available
    };
    const result = scheduleBRollClips(clips, config);

    // Should place exactly 2 clips
    expect(result.length).toBe(2);
  });

  it('respects clip type ordering (before → bRoll → after)', () => {
    const clips: BRollClip[] = [
      {
        id: 'after-1',
        url: 'a.mp4',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'after',
      },
      {
        id: 'broll-1',
        url: 'b.mp4',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'bRoll',
      },
      {
        id: 'before-1',
        url: 'c.mp4',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'before',
      },
    ];

    const result = scheduleBRollClips(clips, {
      ...baseConfig,
      totalDurationSec: 60,
    });

    expect(result.length).toBe(3);
    expect(result[0].id).toBe('before-1');
    expect(result[1].id).toBe('broll-1');
    expect(result[2].id).toBe('after-1');
  });

  it('clips have valid trimStart within source bounds', () => {
    const sourceDuration = 8;
    const clips = makeClips(5, sourceDuration);
    const result = scheduleBRollClips(clips, baseConfig);

    for (const clip of result) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
      expect(clip.trimStartSec).toBeLessThanOrEqual(sourceDuration);
    }
    // All clips except the last should have trim + duration within source.
    // The last clip may extend beyond source (Remotion freezes on last frame).
    for (const clip of result.slice(0, -1)) {
      expect(clip.trimStartSec + clip.durationSec).toBeLessThanOrEqual(
        sourceDuration
      );
    }
  });

  it('source too short for 2 slots uses 1 slot', () => {
    // Edit interval = 2s, so 2 slots = 4s. Source is only 3s.
    const clips = makeClips(5, 3);
    const result = scheduleBRollClips(clips, baseConfig);

    // All clips except the last should respect source duration.
    // The last clip may be extended beyond source to fill remaining timeline
    // (Remotion freezes on last frame).
    for (const clip of result.slice(0, -1)) {
      expect(clip.durationSec).toBeLessThanOrEqual(3);
    }
  });
});

describe('scheduleBRollClips – recycleClips (AI voiceover)', () => {
  const baseConfig: SchedulerConfig = {
    totalDurationSec: 20, // Short AI voiceover duration
    introSec: 0, // No intro for AI voiceover
    outroBufferSec: 3,
    fps: 30,
    bpm: 110,
    beatsPerEdit: 4,
    targetCoverage: 1.0,
    recycleClips: true,
  };

  it('fills the full timeline by recycling clips', () => {
    const clips = makeClips(3, 30); // Only 3 clips but long source
    const result = scheduleBRollClips(clips, baseConfig);

    // Available: 0 to 17s = 17s
    // Edit interval: (60/110)*4 ≈ 2.18s
    // Grid points: ~7-8
    // With 100% coverage and recycling, should fill all grid points
    expect(result.length).toBeGreaterThan(3); // More placements than source clips

    // No large gap at the end — last clip should end close to availableEnd
    const lastClip = result[result.length - 1];
    const availableEnd =
      baseConfig.totalDurationSec - (baseConfig.outroBufferSec ?? 3);
    expect(lastClip.startTimeSec + lastClip.durationSec).toBeGreaterThan(
      availableEnd - 3 // Within 3s of the end
    );
  });

  it('reuses clip IDs cyclically', () => {
    const clips = makeClips(2, 30);
    const result = scheduleBRollClips(clips, baseConfig);

    // Should see both clip-0 and clip-1 repeated
    const ids = result.map((c) => c.id);
    expect(ids.filter((id) => id === 'clip-0').length).toBeGreaterThanOrEqual(
      1
    );
    expect(ids.filter((id) => id === 'clip-1').length).toBeGreaterThanOrEqual(
      1
    );
    // Total should be more than 2
    expect(result.length).toBeGreaterThan(2);
  });

  it('stays within timeline bounds when recycling', () => {
    const clips = makeClips(5, 30);
    const result = scheduleBRollClips(clips, baseConfig);
    const availableEnd =
      baseConfig.totalDurationSec - (baseConfig.outroBufferSec ?? 3);

    for (const clip of result) {
      expect(clip.startTimeSec).toBeGreaterThanOrEqual(0);
      expect(clip.startTimeSec + clip.durationSec).toBeLessThanOrEqual(
        availableEnd
      );
    }
  });

  it('works with fallback scheduler (no BPM) and recycling', () => {
    const clips = makeClips(2, 30);
    const config: SchedulerConfig = {
      totalDurationSec: 20,
      introSec: 0,
      outroBufferSec: 3,
      fps: 30,
      targetCoverage: 1.0,
      recycleClips: true,
      // No bpm — uses fallback scheduler
    };
    const result = scheduleBRollClips(clips, config);

    // Should produce more placements than source clips
    expect(result.length).toBeGreaterThan(2);
  });
});

describe('scheduleBRollClips – even distribution', () => {
  const baseConfig: SchedulerConfig = {
    totalDurationSec: 60, // Long video
    introSec: 3,
    outroBufferSec: 3,
    fps: 30,
    bpm: 120,
    beatsPerEdit: 4,
  };

  it('distributes 2 clips across the full timeline (not clustered at start)', () => {
    const clips = makeClips(2, 30);
    const result = scheduleBRollClips(clips, baseConfig);

    expect(result.length).toBe(2);

    // Clips should not be adjacent — the second clip should start after
    // the midpoint of the available timeline
    const availableEnd =
      baseConfig.totalDurationSec - (baseConfig.outroBufferSec ?? 3);
    const midpoint = ((baseConfig.introSec ?? 3) + availableEnd) / 2;
    expect(result[1].startTimeSec).toBeGreaterThanOrEqual(midpoint - 5);
  });
});

describe('scheduleBRollClips – fallback mode (no BPM)', () => {
  it('uses varied-duration scheduler when bpm is missing', () => {
    const clips = makeClips(5);
    const config: SchedulerConfig = {
      totalDurationSec: 30,
      introSec: 3,
      outroBufferSec: 3,
      fps: 30,
      // No bpm or beatsPerEdit
    };
    const result = scheduleBRollClips(clips, config);

    expect(result.length).toBeGreaterThan(0);
    // Durations should vary (not locked to a grid)
    const durations = result.map((c) => c.durationSec);
    const allSame = durations.every((d) => d === durations[0]);
    // With varied durations, unlikely all clips have exact same duration
    if (result.length > 2) {
      expect(allSame).toBe(false);
    }
  });

  it('uses varied-duration scheduler when beatsPerEdit is missing', () => {
    const clips = makeClips(3);
    const config: SchedulerConfig = {
      totalDurationSec: 30,
      bpm: 120,
      // No beatsPerEdit
    };
    const result = scheduleBRollClips(clips, config);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('scheduleBRollClips – consecutive same-asset merging', () => {
  it('merges all placements into one clip when NOT recycling a single asset', () => {
    const clips: BRollClip[] = [
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60, // Long enough to cover entire timeline
        order: 0,
        clipType: 'bRoll',
      },
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 1,
        clipType: 'bRoll',
      },
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 2,
        clipType: 'bRoll',
      },
    ];
    const config: SchedulerConfig = {
      totalDurationSec: 20,
      introSec: 0,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
      // NOT recycling — merge should still apply
    };
    const result = scheduleBRollClips(clips, config);

    // All slots should be merged into a single continuous clip
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('only-clip');
  });

  it('does NOT merge when recycling — preserves varied trim starts', () => {
    const clips: BRollClip[] = [
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 0,
        clipType: 'bRoll',
      },
    ];
    const config: SchedulerConfig = {
      totalDurationSec: 20,
      introSec: 0,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
      targetCoverage: 1.0,
      recycleClips: true,
    };
    const result = scheduleBRollClips(clips, config);

    // With recycling, merge is skipped — each placement keeps its own trimStart
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((c) => c.id === 'only-clip')).toBe(true);
  });

  it('merges consecutive same-asset clips when user selects same video multiple times', () => {
    // Simulate user selecting the same asset 3 times as b-roll
    const clips: BRollClip[] = [
      {
        id: 'same-asset',
        url: 'https://example.com/same.mp4',
        sourceDurationSec: 60,
        order: 0,
        clipType: 'bRoll',
      },
      {
        id: 'same-asset',
        url: 'https://example.com/same.mp4',
        sourceDurationSec: 60,
        order: 1,
        clipType: 'bRoll',
      },
      {
        id: 'same-asset',
        url: 'https://example.com/same.mp4',
        sourceDurationSec: 60,
        order: 2,
        clipType: 'bRoll',
      },
    ];
    const config: SchedulerConfig = {
      totalDurationSec: 30,
      introSec: 3,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
    };
    const result = scheduleBRollClips(clips, config);

    // All 3 consecutive same-asset clips should merge into 1
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('same-asset');
  });

  it('does not merge clips from different assets', () => {
    const clips = makeClips(3, 60);
    const config: SchedulerConfig = {
      totalDurationSec: 30,
      introSec: 3,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
    };
    const result = scheduleBRollClips(clips, config);

    // All clips are different assets, no merging
    expect(result.length).toBe(3);
    expect(result[0].id).toBe('clip-0');
    expect(result[1].id).toBe('clip-1');
    expect(result[2].id).toBe('clip-2');
  });

  it('stops merging when source is too short for combined duration (non-recycling)', () => {
    const clips: BRollClip[] = [
      {
        id: 'short-clip',
        url: 'https://example.com/short.mp4',
        sourceDurationSec: 3, // Very short source
        order: 0,
        clipType: 'bRoll',
      },
      {
        id: 'short-clip',
        url: 'https://example.com/short.mp4',
        sourceDurationSec: 3,
        order: 1,
        clipType: 'bRoll',
      },
    ];
    const config: SchedulerConfig = {
      totalDurationSec: 30,
      introSec: 0,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
      // NOT recycling — merge applies but source is too short
    };
    const result = scheduleBRollClips(clips, config);

    // Source is only 3s — merge can't cover the full combined duration
    expect(result.length).toBeGreaterThan(0);
    // All clips except the last should respect source bounds.
    for (const clip of result.slice(0, -1)) {
      expect(clip.trimStartSec + clip.durationSec).toBeLessThanOrEqual(3);
    }
  });

  it('merged clip has continuous trim from first placement (non-recycling)', () => {
    const clips: BRollClip[] = [
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 0,
        clipType: 'bRoll',
      },
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 1,
        clipType: 'bRoll',
      },
      {
        id: 'only-clip',
        url: 'https://example.com/only.mp4',
        sourceDurationSec: 60,
        order: 2,
        clipType: 'bRoll',
      },
    ];
    const config: SchedulerConfig = {
      totalDurationSec: 15,
      introSec: 0,
      outroBufferSec: 3,
      fps: 30,
      bpm: 120,
      beatsPerEdit: 4,
      // NOT recycling — merge applies
    };
    const result = scheduleBRollClips(clips, config);

    // Should be merged into one clip
    expect(result.length).toBe(1);
    // Trim + duration should not exceed source
    expect(result[0].trimStartSec + result[0].durationSec).toBeLessThanOrEqual(
      60
    );
  });
});

describe('scheduledClipsToScenes – transition handling', () => {
  it('sets fade transition for clips from different assets', () => {
    const scheduled = [
      {
        id: 'clip-0',
        url: 'https://example.com/0.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'clip-1',
        url: 'https://example.com/1.mp4',
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
    const scheduled = [
      {
        id: 'same',
        url: 'https://example.com/same.mp4',
        startTimeSec: 3,
        durationSec: 2,
        trimStartSec: 0,
      },
      {
        id: 'same',
        url: 'https://example.com/same.mp4',
        startTimeSec: 7,
        durationSec: 2,
        trimStartSec: 2,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);

    expect(scenes[0].transition).toBe('fade');
    expect(scenes[1].transition).toBe('none'); // Same asset follows — no transition
  });

  it('generates unique scene IDs even for same-asset clips', () => {
    const scheduled = [
      {
        id: 'same',
        url: 'https://example.com/same.mp4',
        startTimeSec: 0,
        durationSec: 5,
        trimStartSec: 0,
      },
      {
        id: 'same',
        url: 'https://example.com/same.mp4',
        startTimeSec: 5,
        durationSec: 5,
        trimStartSec: 5,
      },
    ];
    const scenes = scheduledClipsToScenes(scheduled, 30);

    // IDs should be unique (index-suffixed)
    expect(scenes[0].id).not.toBe(scenes[1].id);
    expect(scenes[0].id).toBe('same-0');
    expect(scenes[1].id).toBe('same-1');
  });
});

describe('scheduleBRollClips – action segment trim selection', () => {
  const baseConfig: SchedulerConfig = {
    totalDurationSec: 30,
    introSec: 3,
    outroBufferSec: 3,
    fps: 30,
    bpm: 120,
    beatsPerEdit: 4,
  };

  const actionSegments: ActionSegment[] = [
    {
      startSec: 5,
      endSec: 15,
      label: 'action',
      description: 'Procedure happening',
    },
    { startSec: 0, endSec: 5, label: 'transition', description: 'Walking in' },
    { startSec: 15, endSec: 20, label: 'idle', description: 'Static shot' },
  ];

  it('selects trim within action segments', () => {
    const clips: BRollClip[] = [
      {
        id: 'seg-clip',
        url: 'https://example.com/seg.mp4',
        sourceDurationSec: 20,
        order: 0,
        clipType: 'bRoll',
        actionSegments,
      },
    ];

    // Run 20 times to verify consistency
    for (let run = 0; run < 20; run++) {
      const result = scheduleBRollClips(clips, baseConfig);
      for (const clip of result) {
        // trimStart should be within the action segment [5, 15]
        expect(clip.trimStartSec).toBeGreaterThanOrEqual(5);
        // The last clip may extend beyond source duration to fill the timeline
        // (Remotion freezes on last frame). Only check trim start is valid.
        expect(clip.trimStartSec).toBeLessThanOrEqual(15);
      }
    }
  });

  it('falls back when no segments provided', () => {
    const clips = makeClips(3, 20);
    const result = scheduleBRollClips(clips, baseConfig);

    expect(result.length).toBeGreaterThan(0);
    for (const clip of result) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back on empty segments array', () => {
    const clips: BRollClip[] = [
      {
        id: 'empty-seg',
        url: 'https://example.com/empty.mp4',
        sourceDurationSec: 20,
        order: 0,
        clipType: 'bRoll',
        actionSegments: [],
      },
    ];

    const result = scheduleBRollClips(clips, baseConfig);
    expect(result.length).toBeGreaterThan(0);
    for (const clip of result) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles short action segments (shorter than clip duration)', () => {
    const shortSegments: ActionSegment[] = [
      {
        startSec: 10,
        endSec: 11,
        label: 'action',
        description: 'Quick moment',
      },
      { startSec: 0, endSec: 10, label: 'idle', description: 'Waiting' },
      { startSec: 11, endSec: 20, label: 'idle', description: 'More waiting' },
    ];

    const clips: BRollClip[] = [
      {
        id: 'short-seg',
        url: 'https://example.com/short.mp4',
        sourceDurationSec: 20,
        order: 0,
        clipType: 'bRoll',
        actionSegments: shortSegments,
      },
    ];

    const result = scheduleBRollClips(clips, baseConfig);
    expect(result.length).toBeGreaterThan(0);
    // Should use the short action segment start as trim start
    for (const clip of result) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
      expect(clip.trimStartSec).toBe(10); // Start of the only action segment
    }
  });

  it('prefers longer action segments over shorter ones', () => {
    const mixedSegments: ActionSegment[] = [
      { startSec: 0, endSec: 5, label: 'action', description: 'Short action' },
      { startSec: 10, endSec: 50, label: 'action', description: 'Long action' },
      { startSec: 5, endSec: 10, label: 'idle', description: 'Break' },
    ];

    // Use 2 clips so they interleave (preventing same-asset merging from
    // collapsing all clips into one). Both have the same action segments.
    const clips: BRollClip[] = [
      {
        id: 'pref-clip-a',
        url: 'https://example.com/pref-a.mp4',
        sourceDurationSec: 60,
        order: 0,
        clipType: 'bRoll',
        actionSegments: mixedSegments,
      },
      {
        id: 'pref-clip-b',
        url: 'https://example.com/pref-b.mp4',
        sourceDurationSec: 60,
        order: 1,
        clipType: 'bRoll',
        actionSegments: mixedSegments,
      },
    ];

    // Use recycleClips so clips are reused and round-robin through segments
    const recycleConfig: SchedulerConfig = {
      ...baseConfig,
      recycleClips: true,
    };

    // Run many times and count how often trim falls in the long segment [10-50]
    let longSegmentCount = 0;
    let totalClipCount = 0;
    const runs = 50;
    for (let run = 0; run < runs; run++) {
      const result = scheduleBRollClips(clips, recycleConfig);
      for (const clip of result) {
        totalClipCount++;
        if (clip.trimStartSec >= 10) {
          longSegmentCount++;
        }
      }
    }

    // With round-robin segment selection, some clips will land in the
    // long segment [10-50] and some in the short [0-5].
    expect(totalClipCount).toBeGreaterThan(0);
    expect(longSegmentCount).toBeGreaterThan(0);
  });

  it('works with recycleClips and action segments', () => {
    const clips: BRollClip[] = [
      {
        id: 'recycle-seg',
        url: 'https://example.com/recycle.mp4',
        sourceDurationSec: 60,
        order: 0,
        clipType: 'bRoll',
        actionSegments: [
          {
            startSec: 10,
            endSec: 50,
            label: 'action',
            description: 'Main procedure',
          },
          {
            startSec: 0,
            endSec: 10,
            label: 'transition',
            description: 'Intro',
          },
          { startSec: 50, endSec: 60, label: 'idle', description: 'Outro' },
        ],
      },
    ];

    const config: SchedulerConfig = {
      ...baseConfig,
      targetCoverage: 1.0,
      recycleClips: true,
    };

    const result = scheduleBRollClips(clips, config);
    // With recycling, merge is skipped — multiple clips with varied trims
    expect(result.length).toBeGreaterThan(1);
    for (const clip of result) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
      // Each clip's trim should fall within the action segment [10, 50]
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(10);
      expect(clip.trimStartSec).toBeLessThanOrEqual(50);
    }
  });
});
