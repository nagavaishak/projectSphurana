import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type { Scene, TemplateVariationId } from '../types/video-config';
import { MAX_TRANSITION_FRAMES } from './b-roll-layer';

export interface TalkingHeadLayerProps {
  /** The main talking head scene (should be the full-length base video) */
  scene: Scene;
  /** B-roll scenes that overlay the talking head */
  bRollScenes: Scene[];
  /** Frames per second */
  fps: number;
  /** Template variation ID for variation-specific rendering */
  variationId?: TemplateVariationId;
}

/** Min/max scale for Ken Burns zoom effect on testimonial talking head */
const KEN_BURNS_SCALE_MIN = 1.0;
const KEN_BURNS_SCALE_MAX = 1.08;

interface GapSegment {
  start: number;
  end: number;
}

/**
 * Compute the "gap" segments where the talking head is visible
 * (i.e. intervals between b-roll clips, plus before-first and after-last).
 */
function computeGapSegments(
  bRollScenes: Scene[],
  totalDurationInFrames: number
): GapSegment[] {
  if (bRollScenes.length === 0) {
    return [{ start: 0, end: totalDurationInFrames }];
  }

  const sorted = [...bRollScenes].sort((a, b) => a.startFrame - b.startFrame);
  const gaps: GapSegment[] = [];

  // Gap before first b-roll
  if (sorted[0].startFrame > 0) {
    gaps.push({ start: 0, end: sorted[0].startFrame });
  }

  // Gaps between consecutive b-roll clips
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = sorted[i].startFrame + sorted[i].durationInFrames;
    const nextStart = sorted[i + 1].startFrame;
    if (nextStart > currentEnd) {
      gaps.push({ start: currentEnd, end: nextStart });
    }
  }

  // Gap after last b-roll
  const lastBRoll = sorted[sorted.length - 1];
  const lastEnd = lastBRoll.startFrame + lastBRoll.durationInFrames;
  if (lastEnd < totalDurationInFrames) {
    gaps.push({ start: lastEnd, end: totalDurationInFrames });
  }

  return gaps;
}

/**
 * Talking Head Layer - renders the main talking head video with continuous audio
 *
 * Key audio sync architecture:
 * - The talking head VIDEO is hidden when b-roll is playing
 * - The talking head AUDIO continues playing throughout (never interrupted)
 * - This creates seamless audio continuity even during visual cutaways
 *
 * Visual behavior:
 * - When no b-roll is active: talking head video is fully visible
 * - When b-roll is active: talking head video fades out but audio continues
 *
 * Variation-specific behavior:
 * - testimonial variations: Alternating Ken Burns zoom-in/zoom-out on talking
 *   head segments between b-roll clips for visual engagement
 */
export const TalkingHeadLayer: React.FC<TalkingHeadLayerProps> = ({
  scene,
  bRollScenes,
  fps,
  variationId,
}) => {
  const frame = useCurrentFrame();

  // Check if any b-roll scene is currently active
  const activeBRoll = bRollScenes.find(
    (bRoll) =>
      frame >= bRoll.startFrame &&
      frame < bRoll.startFrame + bRoll.durationInFrames
  );

  const isTestimonialVariation =
    variationId?.startsWith('testimonial-') ?? false;

  // Find the first b-roll scene (matches b-roll layer logic: no transition for first clip)
  const firstBRollStartFrame =
    bRollScenes.length > 0
      ? Math.min(...bRollScenes.map((s) => s.startFrame))
      : Number.POSITIVE_INFINITY;

  // When b-roll is active, crossfade the talking head out over the same
  // transition duration the b-roll uses to fade in.  This prevents a black
  // gap where both layers are transparent.
  // The first b-roll clip has no transition, so the talking head hides instantly.
  let videoOpacity = 1;
  if (activeBRoll) {
    const isFirstBRoll = activeBRoll.startFrame === firstBRollStartFrame;
    const hasNoTransition = activeBRoll.transition === 'none';
    if (isFirstBRoll || hasNoTransition) {
      // No transition on this b-roll clip — hide talking head immediately
      videoOpacity = 0;
    } else {
      const framesIntoBRoll = frame - activeBRoll.startFrame;
      const transitionDuration = Math.min(
        MAX_TRANSITION_FRAMES,
        activeBRoll.durationInFrames / 4
      );
      // Crossfade: talking head fades out as b-roll fades in
      videoOpacity = interpolate(
        framesIntoBRoll,
        [0, transitionDuration],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    }
  }

  // Ken Burns zoom for testimonial variations
  let kenBurnsScale = 1;
  if (isTestimonialVariation && bRollScenes.length > 0) {
    const totalDuration = scene.durationInFrames;
    const gapSegments = computeGapSegments(bRollScenes, totalDuration);

    const currentGapIndex = gapSegments.findIndex(
      (gap) => frame >= gap.start && frame < gap.end
    );

    if (currentGapIndex >= 0) {
      const gap = gapSegments[currentGapIndex];
      const gapDuration = gap.end - gap.start;
      const progress = gapDuration > 0 ? (frame - gap.start) / gapDuration : 0;
      const isZoomIn = currentGapIndex % 2 === 0;

      kenBurnsScale = isZoomIn
        ? interpolate(
            progress,
            [0, 1],
            [KEN_BURNS_SCALE_MIN, KEN_BURNS_SCALE_MAX]
          )
        : interpolate(
            progress,
            [0, 1],
            [KEN_BURNS_SCALE_MAX, KEN_BURNS_SCALE_MIN]
          );
    }
  }

  const needsKenBurns = isTestimonialVariation && kenBurnsScale !== 1;

  return (
    <AbsoluteFill>
      {/* Video layer - hidden when b-roll is active */}
      <AbsoluteFill
        style={{
          opacity: videoOpacity,
          overflow: needsKenBurns ? 'hidden' : undefined,
        }}
      >
        <OffthreadVideo
          src={scene.clipUrl}
          // Mute the video element - we use a separate Audio component for audio
          muted
          startFrom={scene.trimStart}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: needsKenBurns ? `scale(${kenBurnsScale})` : undefined,
          }}
        />
      </AbsoluteFill>

      {/* Audio layer - plays continuously regardless of b-roll visibility */}
      <Audio src={scene.clipUrl} startFrom={scene.trimStart / fps} volume={1} />
    </AbsoluteFill>
  );
};
