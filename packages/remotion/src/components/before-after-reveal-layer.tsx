import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Scene } from '../types/video-config';

export interface BeforeAfterRevealLayerProps {
  scenes: Scene[];
  fps: number;
}

/** Frames for the PiP slide-in / slide-out animation */
const PIP_ANIM_FRAMES = 10;

/** Gap between before scene end and text appearance (in seconds) */
const TEXT_DELAY_SECONDS = 1.5;

/** Duration the text is visible (in seconds) */
const TEXT_DURATION_SECONDS = 2;

const WHOOSH_SFX = staticFile('sfx/whoosh.mp3');

/**
 * Before PiP - renders the "before" clip as a small picture-in-picture
 * in the top-right corner with slide-in/out animation.
 */
const BeforePip: React.FC<{
  scene: Scene;
}> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = scene;

  const slideOffset = 120; // slide from right edge (percentage)
  const animIn = Math.min(PIP_ANIM_FRAMES, durationInFrames / 4);
  const animOut = Math.min(PIP_ANIM_FRAMES, durationInFrames / 4);
  const outStart = durationInFrames - animOut;

  const translateX = interpolate(
    frame,
    [0, animIn, outStart, durationInFrames],
    [slideOffset, 0, 0, slideOffset],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        width: '30%',
        transform: `translateX(${translateX}%)`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          borderRadius: 12,
          overflow: 'hidden',
          border: '3px solid white',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          aspectRatio: '3 / 4',
        }}
      >
        {scene.mediaType === 'image' ? (
          <Img
            src={scene.clipUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <OffthreadVideo
            src={scene.clipUrl}
            muted
            startFrom={scene.trimStart}
            endAt={scene.trimStart + scene.durationInFrames}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * "CLIENT RESULTS COMING NOW" interstitial text overlay.
 * Spring-in animation (scale 0.85 -> 1 + fade) then fades out.
 */
const ResultsText: React.FC<{
  durationInFrames: number;
}> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Spring-in for the first 0.5s
  const scaleSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });
  const scale = interpolate(scaleSpring, [0, 1], [0.85, 1]);

  // Fade in over first 8 frames
  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out over last 10 frames
  const fadeOutStart = durationInFrames - 10;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 72,
          fontWeight: 900,
          color: '#FFFFFF',
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          lineHeight: 1.2,
          padding: '0 40px',
          // Black text stroke for contrast (TikTok caption style)
          WebkitTextStroke: '3px #000000',
          paintOrder: 'stroke fill',
          textShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        }}
      >
        CLIENT RESULTS
        <br />
        COMING NOW
      </div>
    </AbsoluteFill>
  );
};

/**
 * @deprecated Use the modular components instead:
 * - PipOverlayLayer for "before" PiP
 * - TextInterstitialLayer for transition text
 * - FullScreenRevealLayer for "after" reveal with Ken Burns
 *
 * Kept for backwards compatibility with existing video configs that don't
 * have textInterstitials/fullScreenReveals fields.
 *
 * Legacy flow:
 * 1. Before clip renders as PiP (top-right, 30% width) with whoosh SFX
 * 2. Gap of background footage
 * 3. "CLIENT RESULTS COMING NOW" text overlay with spring animation
 * 4. After scene gets a whoosh SFX when it starts (renders full-screen via BRollLayer)
 */
export const BeforeAfterRevealLayer: React.FC<BeforeAfterRevealLayerProps> = ({
  scenes,
  fps,
}) => {
  const bRollScenes = scenes.filter((s) => s.type === 'b-roll');

  const beforeScene = bRollScenes.find((s) => s.bRollType === 'before');
  const afterScene = bRollScenes.find((s) => s.bRollType === 'after');

  if (!beforeScene && !afterScene) {
    return null;
  }

  // Calculate text timing
  const textDelayFrames = Math.round(TEXT_DELAY_SECONDS * fps);
  const textDurationFrames = Math.round(TEXT_DURATION_SECONDS * fps);

  // Text appears after the before scene ends + gap
  const beforeEndFrame = beforeScene
    ? beforeScene.startFrame + beforeScene.durationInFrames
    : 0;

  const textStartFrame = beforeScene
    ? beforeEndFrame + textDelayFrames
    : undefined;

  // Clamp text duration so it ends before the after scene starts (with 0.5s buffer)
  const bufferFrames = Math.round(0.5 * fps);
  const actualTextDuration =
    textStartFrame !== undefined && afterScene
      ? Math.min(
          textDurationFrames,
          afterScene.startFrame - textStartFrame - bufferFrames
        )
      : textDurationFrames;

  const showText =
    textStartFrame !== undefined && actualTextDuration > fps * 0.5; // Only show if > 0.5s visible

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Before scene as PiP with whoosh */}
      {beforeScene && (
        <Sequence
          from={beforeScene.startFrame}
          durationInFrames={beforeScene.durationInFrames}
        >
          <BeforePip scene={beforeScene} />
          <Audio src={WHOOSH_SFX} volume={0.5} />
        </Sequence>
      )}

      {/* "CLIENT RESULTS COMING NOW" text */}
      {showText && textStartFrame !== undefined && (
        <Sequence from={textStartFrame} durationInFrames={actualTextDuration}>
          <ResultsText durationInFrames={actualTextDuration} />
        </Sequence>
      )}

      {/* Whoosh SFX when after scene starts */}
      {afterScene && (
        <Sequence
          from={afterScene.startFrame}
          durationInFrames={Math.round(fps)} // 1 second for the audio to play
        >
          <Audio src={WHOOSH_SFX} volume={0.5} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
