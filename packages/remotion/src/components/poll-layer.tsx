import type React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  REEL_PALETTE,
  accentTextColor,
  deepAccentColor,
} from '../types/reel-palette';
import type { PollConfig } from '../types/video-config';

export interface PollLayerProps {
  config: PollConfig;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Instagram's action-icon language, drawn inline: red filled heart, outline
 * comment bubble, paper-plane share. */
const HeartIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="#FF3040"
    role="img"
    aria-label="Like"
  >
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

const CommentIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.1}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label="Comment"
  >
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
);

const ShareIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.1}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label="Share"
  >
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </svg>
);

/** One vote row: IG action icon chip + action verb + option label. */
const VoteRow: React.FC<{
  icon: 'like' | 'comment' | 'share';
  action: string;
  label: string;
  filled: boolean;
  delayFrames: number;
  accent: string;
  deep: string;
}> = ({ icon, action, label, filled, delayFrames, accent, deep }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({
    frame: frame - delayFrames,
    fps,
    config: { damping: 14, mass: 0.7, stiffness: 150 },
    durationInFrames: 12,
  });
  const scale = interpolate(pop, [0, 1], [0.86, 1]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        width: '100%',
        padding: '24px 30px',
        borderRadius: 22,
        backgroundColor: filled ? accent : REEL_PALETTE.paper,
        boxShadow: '0 10px 34px rgba(0,0,0,0.35)',
        opacity: pop,
        transform: `scale(${scale})`,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 72,
          height: 72,
          borderRadius: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled
            ? 'rgba(255,255,255,0.4)'
            : 'rgba(21,22,28,0.06)',
        }}
      >
        {icon === 'like' ? (
          <HeartIcon size={42} />
        ) : icon === 'comment' ? (
          <CommentIcon size={42} color={REEL_PALETTE.slate} />
        ) : (
          <ShareIcon size={40} color={REEL_PALETTE.slate} />
        )}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 25,
            fontWeight: 800,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: filled ? accentTextColor(accent) : deep,
          }}
        >
          {action}
        </span>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 42,
            fontWeight: 800,
            lineHeight: 1.12,
            color: filled ? accentTextColor(accent) : REEL_PALETTE.slate,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
};

/**
 * PollLayer — organic "engagement poll" template.
 *
 * Voting runs on Instagram's own buttons, so the results are natively visible
 * on the post and no API is involved: ❤️ like for option one, 💬 comment for
 * option two, and optionally 🔁 share for a third. The layer renders the
 * question up top, one row per vote action, and a CTA teaching the mechanic.
 */
export const PollLayer: React.FC<PollLayerProps> = ({ config }) => {
  const frame = useCurrentFrame();
  const accent = config.primaryColor ?? REEL_PALETTE.blush;
  const deep = config.secondaryColor ?? deepAccentColor(accent);

  const intro = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Gentle pulse keeps the ask alive without being obnoxious.
  const pulse = 1 + 0.03 * Math.sin((frame / 30) * Math.PI * 2);

  const rows = [
    {
      icon: 'like' as const,
      action: 'Like',
      label: config.likeLabel,
      filled: true,
      delay: 8,
    },
    {
      icon: 'comment' as const,
      action: 'Comment',
      label: config.commentLabel,
      filled: false,
      delay: 14,
    },
    ...(config.shareLabel
      ? [
          {
            icon: 'share' as const,
            action: 'Share',
            label: config.shareLabel,
            filled: false,
            delay: 20,
          },
        ]
      : []),
  ];

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.24) 30%, rgba(0,0,0,0.24) 62%, rgba(0,0,0,0.66) 100%)',
        }}
      />

      {/* Question, top-centre. */}
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: '9.5%',
          opacity: intro,
        }}
      >
        <div
          style={{
            maxWidth: '86%',
            textAlign: 'center',
            fontFamily: SANS,
            fontSize: 58,
            fontWeight: 800,
            lineHeight: 1.14,
            color: '#FFFFFF',
            textShadow: '0 4px 24px rgba(0,0,0,0.55)',
          }}
        >
          {config.question}
        </div>
      </AbsoluteFill>

      {/* Vote rows, centred. */}
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          padding: '0 9%',
        }}
      >
        {rows.map((row) => (
          <VoteRow
            key={row.action}
            icon={row.icon}
            action={row.action}
            label={row.label}
            filled={row.filled}
            delayFrames={row.delay}
            accent={accent}
            deep={deep}
          />
        ))}
      </AbsoluteFill>

      {/* Mechanic CTA, bottom. */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: '12%',
          opacity: intro,
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#FFFFFF',
            backgroundColor: REEL_PALETTE.slateSolid,
            borderRadius: 999,
            padding: '16px 36px',
            transform: `scale(${pulse})`,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}
        >
          Vote with your tap
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
