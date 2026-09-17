import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
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
import type { Scene, StepTimerConfig } from '../types/video-config';

export interface StepTimerLayerProps {
  config: StepTimerConfig;
  bRollScenes: Scene[];
  fps: number;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Default seconds per step when there are fewer clips than steps. */
const DEFAULT_SECONDS_PER_STEP = 2.6;

/**
 * Compute the reveal frame per step: 1:1 with the sorted b-roll cuts when
 * possible so each chip pops exactly on a clip change.
 */
const computeReveals = (
  stepCount: number,
  scenes: Scene[],
  fps: number
): number[] => {
  const sorted = [...scenes].sort((a, b) => a.startFrame - b.startFrame);
  if (stepCount > 0 && sorted.length >= stepCount) {
    return Array.from({ length: stepCount }, (_, i) => sorted[i].startFrame);
  }
  const per = Math.round(DEFAULT_SECONDS_PER_STEP * fps);
  return Array.from({ length: stepCount }, (_, i) => i * per);
};

/**
 * One checklist chip: solid brand-colour pill with the step number, label and
 * a dimmer inline duration. Pops in with a quick scale spring (the observed
 * reel cadence — no slides), then PERSISTS for the rest of the video. Once a
 * newer step is active, the chip dims slightly so the current step reads.
 */
const StepChip: React.FC<{
  index: number;
  label: string;
  duration: string;
  active: boolean;
  dimmed: boolean;
  accent: string;
  deep: string;
}> = ({ index, label, duration, active, dimmed, accent, deep }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.7, stiffness: 160 },
    durationInFrames: 10,
  });
  const scale = interpolate(pop, [0, 1], [0.85, 1]);

  return (
    <div
      style={{
        alignSelf: 'flex-start',
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
        opacity: pop * (dimmed ? 0.8 : 1),
        backgroundColor: active ? accent : REEL_PALETTE.paper,
        borderRadius: 16,
        padding: '16px 28px',
        boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        maxWidth: '86%',
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 40,
          fontWeight: 800,
          color: active ? accentTextColor(accent) : REEL_PALETTE.slate,
          lineHeight: 1.2,
        }}
      >
        {index + 1}. {label}
      </span>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 27,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: active ? accentTextColor(accent) : deep,
          opacity: active ? 0.85 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {duration}
      </span>
    </div>
  );
};

/**
 * StepTimerLayer — organic "step + timer" template, v3.
 *
 * The format that wins in the wild: a persistent title up top, then a
 * BUILDING CHECKLIST of solid brand-colour chips — each step pops in on its
 * clip cut and stays on screen, stacking down the left side, so by the end
 * the full routine is visible (the save-worthy screenshot moment). Earlier
 * chips dim slightly so the active step reads. Durations ride inside each
 * chip; no gimmick countdowns.
 */
export const StepTimerLayer: React.FC<StepTimerLayerProps> = ({
  config,
  bRollScenes,
  fps,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const reveals = computeReveals(config.steps.length, bRollScenes, fps);
  const accent = config.primaryColor ?? REEL_PALETTE.blush;
  const deep = config.secondaryColor ?? deepAccentColor(accent);

  const titleIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Which step is currently active (drives dimming of earlier chips).
  let activeIndex = 0;
  for (let i = 0; i < reveals.length; i++) {
    if (frame >= reveals[i]) activeIndex = i;
  }

  return (
    <AbsoluteFill>
      {/* Cinematic scrim — dark top band for the title, gentle bottom lift.
          The chips carry their own solid background so the mid-frame stays
          bright and the footage does the selling. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.16) 26%, rgba(0,0,0,0.08) 60%, rgba(0,0,0,0.45) 100%)',
        }}
      />

      {/* Persistent title, top-centre. */}
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: '8.5%',
          opacity: titleIn,
        }}
      >
        <div
          style={{
            maxWidth: '84%',
            textAlign: 'center',
            fontFamily: SANS,
            fontSize: 46,
            fontWeight: 800,
            lineHeight: 1.14,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            textShadow: '0 3px 20px rgba(0,0,0,0.55)',
          }}
        >
          {config.title}
        </div>
      </AbsoluteFill>

      {/* Building checklist: each chip appears on its cut and persists to the
          end of the video. Left-anchored stack starting in the upper third. */}
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'flex-start',
          paddingTop: '26%',
          paddingLeft: '7%',
          gap: 18,
        }}
      >
        {config.steps.map((step, index) => {
          const from = reveals[index] ?? 0;
          const remaining = Math.max(durationInFrames - from, 1);
          return (
            <Sequence
              key={`${index}-${step.label}`}
              from={from}
              durationInFrames={remaining}
              layout="none"
            >
              <StepChip
                index={index}
                label={step.label}
                duration={step.duration}
                active={index === activeIndex}
                dimmed={index < activeIndex}
                accent={accent}
                deep={deep}
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
