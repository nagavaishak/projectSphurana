import type React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type {
  Scene,
  TemplateVariationId,
  TransitionType,
} from '../types/video-config';
import {
  BLUR_BACKGROUND_STYLE,
  BlurPadFrame,
  CONTAIN_STYLE,
} from './blur-pad-frame';
import { LabelOverlay } from './label-overlay';

/** Min/max scale for Ken Burns zoom on b-roll images */
const IMAGE_ZOOM_SCALE_MIN = 1.0;
const IMAGE_ZOOM_SCALE_MAX = 1.08;

export interface BRollLayerProps {
  /** B-roll scenes to overlay on top of talking head */
  scenes: Scene[];
  /** Frames per second for calculating trim values */
  fps: number;
  /** Template variation ID for variation-specific rendering */
  variationId?: TemplateVariationId;
}

interface TransitionProps {
  type: TransitionType;
  children: React.ReactNode;
  durationInFrames: number;
}

/**
 * Maximum frames for transition-in effect.
 * Kept short (5 frames ≈ 0.17s at 30fps) so there is no visible black gap
 * between the talking head hiding and the b-roll appearing.
 * Exported so TalkingHeadLayer can use the same value for crossfade.
 */
export const MAX_TRANSITION_FRAMES = 5;

const Transition: React.FC<TransitionProps> = ({
  type,
  children,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const transitionDuration = Math.min(
    MAX_TRANSITION_FRAMES,
    durationInFrames / 4
  );

  if (type === 'none') {
    return <>{children}</>;
  }

  if (type === 'fade') {
    // Only fade IN — b-roll hard-cuts back to talking head when it ends
    const opacity = interpolate(frame, [0, transitionDuration], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return <div style={{ opacity }}>{children}</div>;
  }

  if (type === 'slide-left') {
    const translateX = interpolate(frame, [0, transitionDuration], [100, 0], {
      extrapolateRight: 'clamp',
    });
    return (
      <div style={{ transform: `translateX(${translateX}%)` }}>{children}</div>
    );
  }

  if (type === 'slide-right') {
    const translateX = interpolate(frame, [0, transitionDuration], [-100, 0], {
      extrapolateRight: 'clamp',
    });
    return (
      <div style={{ transform: `translateX(${translateX}%)` }}>{children}</div>
    );
  }

  if (type === 'wipe') {
    const clipPath = interpolate(frame, [0, transitionDuration], [0, 100], {
      extrapolateRight: 'clamp',
    });
    return (
      <div style={{ clipPath: `inset(0 ${100 - clipPath}% 0 0)` }}>
        {children}
      </div>
    );
  }

  return <>{children}</>;
};

/**
 * Get the label text for a b-roll clip based on its type and variation
 * Returns null if no label should be shown
 */
function getLabelForBRollType(
  bRollType: Scene['bRollType'],
  _variationId?: TemplateVariationId
): string | null {
  switch (bRollType) {
    case 'after':
      return 'AFTER';
    default:
      return null;
  }
}

/**
 * B-Roll Image - renders an image with a blurred background fill and Ken Burns zoom.
 * Wide/tall images that don't match the video aspect ratio are shown in full
 * (objectFit: contain) over a blurred, scaled-up copy of the same image.
 */
const BRollImage: React.FC<{
  src: string;
  durationInFrames: number;
  fillsFrame?: boolean;
}> = ({ src, durationInFrames, fillsFrame }) => {
  const frame = useCurrentFrame();
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const scale = interpolate(
    progress,
    [0, 1],
    [IMAGE_ZOOM_SCALE_MIN, IMAGE_ZOOM_SCALE_MAX]
  );

  return (
    <BlurPadFrame
      fillsFrame={fillsFrame}
      background={<Img src={src} style={BLUR_BACKGROUND_STYLE} />}
      foreground={
        <Img
          src={src}
          style={{ ...CONTAIN_STYLE, transform: `scale(${scale})` }}
        />
      }
    />
  );
};

/**
 * B-Roll Video - renders a video with the same blur-pad treatment as stills.
 *
 * Most licensed stock is 16:9 while the compositions are 1080x1920 portrait, so
 * cropping to fill (the previous behaviour) discarded roughly half the frame.
 * The clip is now fitted in full over a blurred copy of itself.
 *
 * Cost note: the blurred background decodes the source a second time. That is
 * affordable only because clips are normalised to 720p landscape / 1080x1920
 * portrait before ingest — two 720p decodes remain far cheaper than one 4K
 * decode. Pass `fillsFrame` for sources already matching the composition
 * aspect ratio to skip the second decode entirely.
 */
const BRollVideo: React.FC<{
  src: string;
  trimStart: number;
  durationInFrames: number;
  fillsFrame?: boolean;
}> = ({ src, trimStart, durationInFrames, fillsFrame }) => {
  // Muted because talking head audio continues underneath.
  const common = {
    src,
    muted: true,
    startFrom: trimStart,
    endAt: trimStart + durationInFrames,
  } as const;

  return (
    <BlurPadFrame
      fillsFrame={fillsFrame}
      background={<OffthreadVideo {...common} style={BLUR_BACKGROUND_STYLE} />}
      foreground={<OffthreadVideo {...common} style={CONTAIN_STYLE} />}
    />
  );
};

/**
 * B-Roll Layer - renders b-roll clips as overlays on top of talking head
 *
 * Key behavior:
 * - B-roll clips are rendered with muted audio (talking head audio continues underneath)
 * - Each b-roll clip is positioned in a Sequence at its startFrame
 * - Transitions are applied when entering/exiting b-roll scenes
 *
 * Before/after rendering:
 * - "before" clips are always excluded (rendered as PiP by BeforeAfterRevealLayer)
 * - "after" clips render full-screen with an "AFTER" label
 */
export const BRollLayer: React.FC<BRollLayerProps> = ({
  scenes,
  fps: _fps,
  variationId,
}) => {
  // Filter to only b-roll scenes
  // Skip "before" scenes — rendered as PiP via PipOverlayLayer / BeforeAfterRevealLayer
  // Skip "after" scenes for before-after-1 — rendered via FullScreenRevealLayer
  const skipAfter = variationId === 'before-after-1';
  const bRollScenes = scenes.filter(
    (scene) =>
      scene.type === 'b-roll' &&
      scene.bRollType !== 'before' &&
      !(skipAfter && scene.bRollType === 'after')
  );

  if (bRollScenes.length === 0) {
    return null;
  }

  // Find the first b-roll scene so we can skip its transition
  const firstBRollId = bRollScenes.reduce(
    (earliest, s) => (s.startFrame < earliest.startFrame ? s : earliest),
    bRollScenes[0]
  ).id;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {bRollScenes.map((scene) => {
        // Check if this scene should have a label
        const labelText = getLabelForBRollType(scene.bRollType, variationId);

        // First b-roll clip appears instantly (no transition)
        const isFirst = scene.id === firstBRollId;
        const transitionType: TransitionType = isFirst
          ? 'none'
          : (scene.transition ?? 'fade');

        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.durationInFrames}
          >
            <Transition
              type={transitionType}
              durationInFrames={scene.durationInFrames}
            >
              <AbsoluteFill>
                {scene.mediaType === 'image' ? (
                  <BRollImage
                    src={scene.clipUrl}
                    durationInFrames={scene.durationInFrames}
                  />
                ) : (
                  <BRollVideo
                    src={scene.clipUrl}
                    trimStart={scene.trimStart}
                    durationInFrames={scene.durationInFrames}
                  />
                )}
                {/* Render label overlay for before-after variation */}
                {labelText && (
                  <LabelOverlay
                    text={labelText}
                    position="top-left"
                    durationInFrames={scene.durationInFrames}
                  />
                )}
              </AbsoluteFill>
            </Transition>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
