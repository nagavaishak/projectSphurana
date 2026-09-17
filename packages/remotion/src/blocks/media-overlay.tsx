import type {
  ResolvedMediaOverlayBlock,
  ResolvedMediaOverlayKenBurns,
  ResolvedMediaOverlayLabel,
  ResolvedMediaOverlayPlacement,
} from '@borradh-workspace/video-templates';
import type React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
} from 'remotion';

import type { BlockRenderer, BlockRendererProps } from './types';

// media-overlay — paints a single image/video clip somewhere over the spine.
// Supports full-bleed (full-screen reveal), corner-PiP, and explicit rect
// placement. Ken Burns is an optional zoom across the visible window. Label is
// an optional inline text overlay for things like "BEFORE"/"AFTER".

function placementToContainerStyle(
  placement: ResolvedMediaOverlayPlacement
): React.CSSProperties {
  if (placement === 'full-bleed') {
    return { position: 'absolute', inset: 0 };
  }
  if (placement.kind === 'corner') {
    const inset = '4%';
    const size = `${placement.sizeRatio * 100}%`;
    const corner = placement.corner;
    const style: React.CSSProperties = {
      position: 'absolute',
      width: size,
      aspectRatio: '3 / 4',
    };
    if (corner === 'tl') {
      style.top = inset;
      style.left = inset;
    } else if (corner === 'tr') {
      style.top = inset;
      style.right = inset;
    } else if (corner === 'bl') {
      style.bottom = inset;
      style.left = inset;
    } else {
      style.bottom = inset;
      style.right = inset;
    }
    return style;
  }
  return {
    position: 'absolute',
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    width: `${placement.w * 100}%`,
    height: `${placement.h * 100}%`,
  };
}

function kenBurnsStyle(
  kb: ResolvedMediaOverlayKenBurns | undefined,
  localFrame: number,
  durationInFrames: number
): { transform?: string; transformOrigin?: string } {
  if (!kb) return {};
  const progress = durationInFrames > 0 ? localFrame / durationInFrames : 0;
  const scale = interpolate(progress, [0, 1], [kb.zoomFrom, kb.zoomTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const origin =
    kb.from === 'left'
      ? '20% 50%'
      : kb.from === 'right'
        ? '80% 50%'
        : '50% 50%';
  return { transform: `scale(${scale})`, transformOrigin: origin };
}

function MediaOverlayLabel({
  label,
}: {
  label: ResolvedMediaOverlayLabel;
}): React.ReactElement {
  const ts = label.typeStyle;
  const inset = '6%';
  const style: React.CSSProperties = {
    position: 'absolute',
    fontFamily: ts.fontFamily,
    fontSize: Math.max(20, ts.fontSize * 0.55),
    fontWeight: ts.fontWeight,
    letterSpacing: `${ts.letterSpacing}em`,
    textTransform: ts.textTransform,
    // The label sits on top of media, so we force white over a dark plate for
    // legibility regardless of what the resolved type-style colour says.
    color: '#fff',
    textShadow: '0 2px 12px rgba(0,0,0,0.6)',
    background: 'rgba(0,0,0,0.45)',
    padding: '6px 14px',
    borderRadius: 6,
  };
  if (label.corner === 'tl') {
    style.top = inset;
    style.left = inset;
  } else if (label.corner === 'tr') {
    style.top = inset;
    style.right = inset;
  } else if (label.corner === 'bl') {
    style.bottom = inset;
    style.left = inset;
  } else {
    style.bottom = inset;
    style.right = inset;
  }
  return <div style={style}>{label.text}</div>;
}

const MediaOverlayComponent: React.FC<BlockRendererProps> = ({ block }) => {
  if (block.kind !== 'media-overlay') return null;
  const overlay = block as ResolvedMediaOverlayBlock;
  const frame = useCurrentFrame();

  const containerStyle = placementToContainerStyle(overlay.placement);
  const kb = kenBurnsStyle(overlay.kenBurns, frame, block.durationInFrames);
  const isCorner =
    overlay.placement !== 'full-bleed' &&
    typeof overlay.placement === 'object' &&
    overlay.placement.kind === 'corner';
  const objectFit: 'cover' | 'contain' =
    overlay.fit === 'contain' || overlay.fit === 'contain-blur'
      ? 'contain'
      : 'cover';

  const cornerFrame: React.CSSProperties = isCorner
    ? {
        border: '3px solid white',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }
    : { overflow: 'hidden' };

  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit,
    ...kb,
  };

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ ...containerStyle, ...cornerFrame }}>
        {overlay.fit === 'contain-blur' && (
          <Img
            src={overlay.clip.url}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'blur(24px) brightness(0.7)',
              transform: 'scale(1.15)',
            }}
          />
        )}
        {overlay.clip.mediaType === 'image' ? (
          <Img src={overlay.clip.url} style={mediaStyle} />
        ) : (
          <OffthreadVideo
            src={overlay.clip.url}
            muted
            startFrom={overlay.clip.trimStartFrames}
            endAt={overlay.clip.trimStartFrames + overlay.clip.durationInFrames}
            style={mediaStyle}
          />
        )}
        {overlay.label && <MediaOverlayLabel label={overlay.label} />}
      </div>
    </AbsoluteFill>
  );
};

export const mediaOverlayRenderer: BlockRenderer<ResolvedMediaOverlayBlock> = {
  kind: 'media-overlay',
  Component: MediaOverlayComponent,
};
