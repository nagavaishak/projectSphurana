import type React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { NumberedListConfig } from '../types/video-config';

export interface NumberedListLayerProps {
  config: NumberedListConfig;
}

/** Frames between each item revealing. */
const ITEM_STAGGER_FRAMES = 10;
/** Frame the title finishes revealing / first item starts. */
const TITLE_FRAMES = 12;

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/**
 * NumberedListLayer — organic "numbered list" template (e.g. "5 things to do
 * after your facial"). Bold uppercase title, then a numbered list with small
 * badges over a darkened b-roll. Title fades in, items stagger up.
 */
export const NumberedListLayer: React.FC<NumberedListLayerProps> = ({
  config,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, TITLE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* Cinematic scrim: heavier top/bottom bands, footage breathes mid-frame. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.34) 35%, rgba(0,0,0,0.34) 65%, rgba(0,0,0,0.66) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 9%',
        }}
      >
        <div
          style={{
            opacity: titleOpacity,
            fontFamily: SANS,
            fontSize: 58,
            fontWeight: 800,
            lineHeight: 1.1,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: '0.01em',
            marginBottom: 44,
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}
        >
          {config.title}
        </div>

        {config.items.map((item, index) => {
          const start = TITLE_FRAMES + index * ITEM_STAGGER_FRAMES;
          const enter = spring({
            frame: frame - start,
            fps,
            config: { damping: 200 },
            durationInFrames: 12,
          });
          const opacity = interpolate(enter, [0, 1], [0, 1]);
          const translateY = interpolate(enter, [0, 1], [22, 0]);

          return (
            <div
              key={`${index}-${item}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                marginBottom: 22,
                opacity,
                transform: `translateY(${translateY}px)`,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: config.primaryColor ?? REEL_PALETTE.blush,
                  color: accentTextColor(
                    config.primaryColor ?? REEL_PALETTE.blush
                  ),
                  fontFamily: SANS,
                  fontSize: 26,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}
              >
                {index + 1}
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 38,
                  fontWeight: 600,
                  color: '#FFFFFF',
                  lineHeight: 1.2,
                  textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                }}
              >
                {item}
              </span>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
