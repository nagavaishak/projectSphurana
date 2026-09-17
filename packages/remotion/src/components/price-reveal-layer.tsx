import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { PriceRevealConfig } from '../types/video-config';

export interface PriceRevealLayerProps {
  config: PriceRevealConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

const ItemRow: React.FC<{ name: string; price: string }> = ({
  name,
  price,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 150, mass: 0.7 },
    durationInFrames: 10,
  });
  const rise = interpolate(enter, [0, 1], [24, 0]);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 18,
        width: '84%',
        backgroundColor: 'rgba(13,15,24,0.62)',
        borderRadius: 14,
        padding: '14px 26px',
        opacity: enter,
        transform: `translateY(${rise}px)`,
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 42,
          fontWeight: 700,
          color: '#FFFFFF',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </span>
      <span
        style={{
          flex: 1,
          borderBottom: '3px dotted rgba(255,255,255,0.35)',
          transform: 'translateY(-8px)',
        }}
      />
      <span
        style={{
          fontFamily: SANS,
          fontSize: 42,
          fontWeight: 800,
          color: REEL_PALETTE.cream,
          whiteSpace: 'nowrap',
        }}
      >
        {price}
      </span>
    </div>
  );
};

/**
 * PriceRevealLayer — organic "price transparency" template.
 *
 * The unGoogleable question up top, then a receipt builds one line-item per
 * beat (rows persist and stack, dotted leaders for the till feel), and the
 * total stamps down big on the final beat with an optional worth-comparison
 * line. Withholding the total is the retention engine.
 */
export const PriceRevealLayer: React.FC<PriceRevealLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = config.primaryColor ?? REEL_PALETTE.blush;

  const segments = 1 + config.items.length + 1; // hook, items, total
  const per = Math.floor(durationInFrames / segments);
  const totalFrom = (1 + config.items.length) * per;
  const hookShrunk = frame >= per;

  const totalIn = spring({
    frame: frame - totalFrom,
    fps,
    config: { damping: 13, stiffness: 170, mass: 0.8 },
    durationInFrames: 12,
  });

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 34%, rgba(0,0,0,0.3) 62%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Hook: big first beat, shrinks to a top strap afterwards. */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: hookShrunk ? 'flex-start' : 'center',
          paddingTop: hookShrunk ? '7%' : 0,
          padding: hookShrunk ? '7% 8% 0' : '0 8%',
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: hookShrunk ? 34 : 60,
            fontWeight: 800,
            lineHeight: 1.2,
            textAlign: 'center',
            color: '#FFFFFF',
            textShadow: '0 3px 20px rgba(0,0,0,0.6)',
          }}
        >
          {config.hook}
        </span>
      </AbsoluteFill>

      {/* Receipt rows: each appears on its beat and persists. */}
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: '38%',
          gap: 16,
        }}
      >
        {config.items.map((item, i) => {
          const from = (i + 1) * per;
          return (
            <Sequence
              key={`item-${i}`}
              from={from}
              durationInFrames={Math.max(durationInFrames - from, 1)}
              layout="none"
            >
              <ItemRow name={item.name} price={item.price} />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {/* Total reveal. */}
      {frame >= totalFrom ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: '14%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              opacity: totalIn,
              transform: `scale(${interpolate(totalIn, [0, 1], [1.15, 1])})`,
            }}
          >
            <span
              style={{
                fontFamily: SANS,
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: '0.24em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              Total
            </span>
            <span
              style={{
                fontFamily: SANS,
                fontSize: 104,
                fontWeight: 800,
                color: accentTextColor(accent),
                backgroundColor: accent,
                borderRadius: 26,
                padding: '10px 46px',
                boxShadow: '0 14px 44px rgba(0,0,0,0.4)',
              }}
            >
              {config.totalPrice}
            </span>
            {config.valueLine ? (
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 36,
                  fontWeight: 700,
                  color: REEL_PALETTE.cream,
                  textShadow: '0 3px 16px rgba(0,0,0,0.55)',
                }}
              >
                {config.valueLine}
              </span>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
