import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { Caption, CaptionStyle } from '../types/video-config';

export interface CaptionsProps {
  captions: Caption[];
  style: CaptionStyle;
}

/**
 * Captions component - renders the current caption based on frame
 */
export const Captions: React.FC<CaptionsProps> = ({ captions, style }) => {
  const frame = useCurrentFrame();

  // Find the active caption for the current frame
  const activeCaption = captions.find(
    (caption) => frame >= caption.startFrame && frame <= caption.endFrame
  );

  if (!activeCaption) {
    return null;
  }

  const positionStyles: Record<typeof style.position, React.CSSProperties> = {
    top: {
      top: 80,
      bottom: 'auto',
    },
    center: {
      top: '50%',
      transform: 'translateY(-50%)',
    },
    bottom: {
      bottom: 120,
      top: 'auto',
    },
  };

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
          position: 'absolute',
          left: 40,
          right: 40,
          display: 'flex',
          justifyContent: 'center',
          ...positionStyles[style.position],
        }}
      >
        <div
          style={{
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            color: style.color,
            backgroundColor: style.showBackground
              ? style.backgroundColor
              : 'transparent',
            padding: style.showBackground ? '12px 24px' : 0,
            borderRadius: 8,
            textAlign: 'center',
            maxWidth: '90%',
            lineHeight: 1.3,
            fontWeight: 600,
            textShadow: style.showBackground
              ? 'none'
              : '2px 2px 4px rgba(0,0,0,0.8)',
          }}
        >
          {activeCaption.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
