import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type { PipOverlay } from '../types/video-config';

export interface PipOverlayLayerProps {
  overlays: PipOverlay[];
}

/** Frames used for slide-in / slide-out animation */
const ANIMATION_FRAMES = 10;

interface PipItemProps {
  overlay: PipOverlay;
}

/**
 * Position mapping to CSS properties.
 * Slide direction is always horizontal (from the nearest edge).
 */
function getPositionStyle(position: PipOverlay['position']) {
  const inset = 24; // px from edge
  switch (position) {
    case 'top-left':
      return { top: inset, left: inset };
    case 'top-right':
      return { top: inset, right: inset };
    case 'bottom-left':
      return { bottom: inset, left: inset };
    case 'bottom-right':
      return { bottom: inset, right: inset };
  }
}

/**
 * Determine slide direction based on position.
 * Items on the left slide in from left (-120%), items on the right from right (120%).
 */
function getSlideOffset(position: PipOverlay['position']) {
  return position.includes('left') ? -120 : 120;
}

const PipItem: React.FC<PipItemProps> = ({ overlay }) => {
  const frame = useCurrentFrame();
  const { position, durationInFrames, label, sizePercent = 20 } = overlay;

  const slideOffset = getSlideOffset(position);
  const animIn = Math.min(ANIMATION_FRAMES, durationInFrames / 4);
  const animOut = Math.min(ANIMATION_FRAMES, durationInFrames / 4);
  const outStart = durationInFrames - animOut;

  // Slide in from edge, then slide out to same edge
  const translateX = interpolate(
    frame,
    [0, animIn, outStart, durationInFrames],
    [slideOffset, 0, 0, slideOffset],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const posStyle = getPositionStyle(position);

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        width: `${sizePercent}%`,
        transform: `translateX(${translateX}%)`,
        pointerEvents: 'none',
      }}
    >
      {/* Thumbnail container */}
      <div
        style={{
          borderRadius: 12,
          overflow: 'hidden',
          border: '3px solid white',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          aspectRatio: '3 / 4',
        }}
      >
        <Img
          src={overlay.imageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>

      {/* Label below thumbnail */}
      {label && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 6,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 14,
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: 2,
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
          }}
        >
          {label}
        </div>
      )}

      {/* Sound effect on slide-in */}
      {overlay.soundEffectUrl && (
        <Audio src={overlay.soundEffectUrl} volume={0.5} />
      )}
    </div>
  );
};

/**
 * PiP Overlay Layer - renders small photo thumbnails in corners of the video.
 *
 * Used for before/after photo overlays during before-after template videos.
 * Each overlay slides in from the nearest horizontal edge with an optional SFX.
 */
export const PipOverlayLayer: React.FC<PipOverlayLayerProps> = ({
  overlays,
}) => {
  if (!overlays || overlays.length === 0) {
    return null;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {overlays.map((overlay, idx) => (
        <Sequence
          key={`pip-${idx}`}
          from={overlay.startFrame}
          durationInFrames={overlay.durationInFrames}
        >
          <PipItem overlay={overlay} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
