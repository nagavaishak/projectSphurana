import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type { FullScreenReveal as FullScreenRevealConfig } from '../types/video-config';
import {
  BLUR_BACKGROUND_STYLE,
  BlurPadFrame,
  CONTAIN_STYLE,
} from './blur-pad-frame';
import { LabelOverlay } from './label-overlay';

export interface FullScreenRevealLayerProps {
  reveals: FullScreenRevealConfig[];
}

const FullScreenRevealItem: React.FC<{
  config: FullScreenRevealConfig;
}> = ({ config }) => {
  const frame = useCurrentFrame();
  const {
    src,
    mediaType,
    durationInFrames,
    trimStart = 0,
    zoomRange = [1.0, 1.12],
    transition = 'fade',
    transitionDurationFrames = 8,
    label,
    labelPosition = 'top-left',
  } = config;

  // Ken Burns zoom — slow zoom throughout the reveal
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const scale = interpolate(progress, [0, 1], zoomRange);

  // Transition in
  const transitionFrames = Math.min(
    transitionDurationFrames,
    durationInFrames / 4
  );
  let transitionStyle: React.CSSProperties = {};

  if (transition === 'fade') {
    const opacity = interpolate(frame, [0, transitionFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transitionStyle = { opacity };
  } else if (transition === 'slide-left') {
    const translateX = interpolate(frame, [0, transitionFrames], [100, 0], {
      extrapolateRight: 'clamp',
    });
    transitionStyle = { transform: `translateX(${translateX}%)` };
  } else if (transition === 'slide-right') {
    const translateX = interpolate(frame, [0, transitionFrames], [-100, 0], {
      extrapolateRight: 'clamp',
    });
    transitionStyle = { transform: `translateX(${translateX}%)` };
  } else if (transition === 'wipe') {
    const clipPath = interpolate(frame, [0, transitionFrames], [0, 100], {
      extrapolateRight: 'clamp',
    });
    transitionStyle = { clipPath: `inset(0 ${100 - clipPath}% 0 0)` };
  }

  return (
    <div style={transitionStyle}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {mediaType === 'image' ? (
          <BlurPadFrame
            background={<Img src={src} style={BLUR_BACKGROUND_STYLE} />}
            foreground={
              <Img
                src={src}
                style={{ ...CONTAIN_STYLE, transform: `scale(${scale})` }}
              />
            }
          />
        ) : (
          // Was objectFit: 'cover' — cropped roughly half of every landscape
          // clip in a portrait composition. Same treatment as stills now.
          <BlurPadFrame
            background={
              <OffthreadVideo
                src={src}
                muted
                startFrom={trimStart}
                endAt={trimStart + durationInFrames}
                style={BLUR_BACKGROUND_STYLE}
              />
            }
            foreground={
              <OffthreadVideo
                src={src}
                muted
                startFrom={trimStart}
                endAt={trimStart + durationInFrames}
                style={{ ...CONTAIN_STYLE, transform: `scale(${scale})` }}
              />
            }
          />
        )}

        {/* Optional label overlay */}
        {label && (
          <LabelOverlay
            text={label}
            position={labelPosition}
            durationInFrames={durationInFrames}
          />
        )}
      </AbsoluteFill>

      {/* Sound effect on appear (defaults to whoosh) */}
      <Audio
        src={config.soundEffectUrl ?? staticFile('sfx/whoosh.mp3')}
        volume={config.soundEffectVolume ?? 0.5}
      />
    </div>
  );
};

/**
 * FullScreenRevealLayer - renders dramatic full-screen image/video transitions
 * with Ken Burns zoom effect and optional SFX.
 *
 * Used for cinematic "after" reveals and other full-screen transitions.
 * Each reveal supports configurable zoom range, transition type, labels, and sound effects.
 */
export const FullScreenRevealLayer: React.FC<FullScreenRevealLayerProps> = ({
  reveals,
}) => {
  if (!reveals || reveals.length === 0) {
    return null;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {reveals.map((config, idx) => (
        <Sequence
          key={`full-screen-reveal-${idx}`}
          from={config.startFrame}
          durationInFrames={config.durationInFrames}
        >
          <FullScreenRevealItem config={config} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
