import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE } from '../types/reel-palette';
import type { TimeProgressConfig } from '../types/video-config';

// One weight/subset only — a bare loadFont() registers every variant, each a
// separate delayRender fetch that can time out the Lambda render.
const { fontFamily: serifFamily } = loadPlayfair('normal', {
  weights: ['700'],
  subsets: ['latin'],
});

export interface TimeProgressLayerProps {
  config: TimeProgressConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Frames the label crossfade takes on the swap (fast, per the format). */
const SWAP_FRAMES = 5;

/**
 * TimeProgressLayer — organic "time-lapse progress" template, v3.
 *
 * The clinic-timeline format observed in the wild: a solid dark header band
 * pinned to the top of the frame with the time marker on the left
 * (hard-swapping from `startLabel` to `endLabel` mid-video) and the clinic
 * wordmark on the right — the footage carries the transformation underneath.
 * The caption sits lower-third in an elegant serif over a soft gradient.
 * No gimmicks: time markers jump, they don't tick.
 */
export const TimeProgressLayer: React.FC<TimeProgressLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const accent = config.primaryColor ?? REEL_PALETTE.gold;

  const intro = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fill runs linearly across the whole video.
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Hard-ish swap just past the midpoint (fast 5-frame crossfade).
  const swapAt = Math.round(durationInFrames * 0.52);
  const cross = interpolate(frame, [swapAt, swapAt + SWAP_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bandLabel: React.CSSProperties = {
    gridArea: '1 / 1',
    fontFamily: SANS,
    fontSize: 44,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#FFFFFF',
    whiteSpace: 'nowrap',
  };

  return (
    <AbsoluteFill>
      {/* Soft lower gradient for the serif caption only — the band handles
          its own contrast and the footage stays clean. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.2) 74%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Clinic header band: time marker left, brand accent tick + wordmark
          right. Persists the whole video; only the label swaps. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 118,
          backgroundColor: REEL_PALETTE.slateSolid,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 46px',
          opacity: intro,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div
            style={{
              width: 10,
              height: 44,
              borderRadius: 999,
              backgroundColor: accent,
            }}
          />
          <div style={{ display: 'grid' }}>
            <span style={{ ...bandLabel, opacity: 1 - cross }}>
              {config.startLabel}
            </span>
            <span style={{ ...bandLabel, opacity: cross }}>
              {config.endLabel}
            </span>
          </div>
        </div>
        {config.businessName ? (
          <span
            style={{
              fontFamily: SANS,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'rgba(239,224,206,0.75)',
            }}
          >
            {config.businessName}
          </span>
        ) : null}
      </div>

      {/* Serif caption, lower third — the clinic voice. */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: '15%',
          opacity: intro,
        }}
      >
        <div
          style={{
            maxWidth: '82%',
            textAlign: 'center',
            fontFamily: serifFamily,
            fontSize: 58,
            fontWeight: 700,
            lineHeight: 1.2,
            color: REEL_PALETTE.cream,
            textShadow: '0 4px 26px rgba(0,0,0,0.55)',
          }}
        >
          {config.caption}
        </div>
      </AbsoluteFill>

      {/* Signature progress bar, pinned to the very bottom: slim rounded
          track, glowing gradient fill and a bright tip dot riding the edge —
          fills linearly across the whole video. */}
      <div
        style={{
          position: 'absolute',
          left: '7%',
          right: '7%',
          bottom: '4.6%',
          opacity: intro,
        }}
      >
        <div
          style={{
            position: 'relative',
            height: 12,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.16)',
            boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.35)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: `${Math.max(progress * 100, 1.5)}%`,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${accent} 0%, #FFFFFF 160%)`,
              boxShadow: `0 0 22px ${accent}, 0 0 6px ${accent}`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${Math.max(progress * 100, 1.5)}%`,
              transform: 'translate(-50%, -50%)',
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              boxShadow: `0 0 18px ${accent}, 0 0 34px ${accent}`,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
