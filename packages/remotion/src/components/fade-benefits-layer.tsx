import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import type React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { FadeBenefitsConfig, Scene } from '../types/video-config';

// Constrain the font load to the one variant we render — a bare loadFont()
// registers the full cartesian product of weights/subsets, each a separate
// delayRender fetch, which times out the Lambda render.
const { fontFamily: serifFamily } = loadPlayfair('normal', {
  weights: ['400', '700'],
  subsets: ['latin'],
});

export interface FadeBenefitsLayerProps {
  config: FadeBenefitsConfig;
  bRollScenes: Scene[];
  fps: number;
  durationInFrames: number;
}

/** Default seconds each statement holds, including its word-by-word reveal. */
const DEFAULT_SECONDS_PER_LINE = 2.6;
/** Frames each word takes to fade fully in. */
const WORD_FADE_FRAMES = 7;
/** Frames between the start of consecutive words (the stagger). */
const WORD_STAGGER_FRAMES = 4;
/** Frames the whole statement takes to fade out at the end. */
const LINE_FADEOUT_FRAMES = 7;
/** Vertical position of the text block as a fraction of viewport height. */
const VERTICAL_POSITION = 0.5;

/**
 * Renders a single benefit statement word-by-word. Earlier words stay solid
 * while later words fade + rise into place — the cadence from organic reels
 * where the caption "writes itself" over the footage.
 */
const FadeStatement: React.FC<{
  text: string;
  durationInFrames: number;
}> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);

  // Hold once every word has appeared, then fade the whole statement out.
  const fadeOut = interpolate(
    frame,
    [durationInFrames - LINE_FADEOUT_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{ justifyContent: 'flex-start', alignItems: 'center' }}
    >
      <div
        style={{
          position: 'absolute',
          top: `${VERTICAL_POSITION * 100}%`,
          transform: 'translateY(-50%)',
          maxWidth: '82%',
          textAlign: 'center',
          opacity: fadeOut,
          lineHeight: 1.18,
        }}
      >
        {words.map((word, index) => {
          const wordStart = index * WORD_STAGGER_FRAMES;
          const appear = interpolate(
            frame,
            [wordStart, wordStart + WORD_FADE_FRAMES],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
          const translateY = interpolate(appear, [0, 1], [14, 0]);
          const isLast = index === words.length - 1;

          return (
            // The trailing space is kept INSIDE the word span (white-space: pre)
            // so word spacing survives — a lone space text node between
            // inline-block boxes gets collapsed by the layout engine.
            <span
              key={`${word}-${index}`}
              style={{
                display: 'inline-block',
                opacity: appear,
                transform: `translateY(${translateY}px)`,
                fontFamily: serifFamily,
                fontSize: 60,
                fontWeight: 700,
                color: REEL_PALETTE.cream,
                whiteSpace: 'pre',
                textShadow:
                  '0 2px 18px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.7)',
              }}
            >
              {isLast ? word : `${word} `}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/**
 * HighlightStatement — the trending reel caption treatment: the whole line
 * fades in on a solid brand-colour block (rounded, padded), holds, then fades
 * out. One line per clip, like FadeStatement, but block-styled instead of
 * word-by-word serif.
 */
const HighlightStatement: React.FC<{
  text: string;
  durationInFrames: number;
  primaryColor: string;
}> = ({ text, durationInFrames, primaryColor }) => {
  const frame = useCurrentFrame();
  const LINE_FADEIN_FRAMES = 8;
  const fadeIn = interpolate(frame, [0, LINE_FADEIN_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - LINE_FADEOUT_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const rise = interpolate(fadeIn, [0, 1], [16, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          maxWidth: '84%',
          textAlign: 'center',
          opacity: Math.min(fadeIn, fadeOut),
          transform: `translateY(${rise}px)`,
        }}
      >
        <span
          style={{
            display: 'inline',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
            backgroundColor: primaryColor,
            color: accentTextColor(primaryColor),
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.5,
            padding: '0.12em 0.32em',
            borderRadius: 10,
            boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

/**
 * Compute a [startFrame, durationInFrames] window for each line.
 *
 * Preferred: map each line 1:1 onto a sorted b-roll scene so the statement
 * changes exactly when the underlying clip cuts (one line per clip). Extra
 * scenes beyond the line count (e.g. an outro tail) are ignored.
 *
 * Fallback (fewer scenes than lines): fixed secondsPerLine sequencing.
 */
const computeWindows = (
  lineCount: number,
  scenes: Scene[],
  secondsPerLine: number,
  fps: number
): Array<{ startFrame: number; durationInFrames: number }> => {
  const sorted = [...scenes].sort((a, b) => a.startFrame - b.startFrame);
  if (lineCount > 0 && sorted.length >= lineCount) {
    return Array.from({ length: lineCount }, (_, i) => ({
      startFrame: sorted[i].startFrame,
      durationInFrames: sorted[i].durationInFrames,
    }));
  }
  const per = Math.round(secondsPerLine * fps);
  return Array.from({ length: lineCount }, (_, i) => ({
    startFrame: i * per,
    durationInFrames: per,
  }));
};

/**
 * FadeBenefitsLayer — organic "fade-in benefits" template.
 *
 * One statement per b-roll clip: each line reveals word-by-word with a soft
 * fade and changes exactly when the underlying clip cuts. Centered bold serif.
 */
export const FadeBenefitsLayer: React.FC<FadeBenefitsLayerProps> = ({
  config,
  bRollScenes,
  fps,
}) => {
  const secondsPerLine = config.secondsPerLine ?? DEFAULT_SECONDS_PER_LINE;
  const windows = computeWindows(
    config.lines.length,
    bRollScenes,
    secondsPerLine,
    fps
  );
  const blockColor = config.primaryColor ?? REEL_PALETTE.cream;

  return (
    <AbsoluteFill>
      {config.lines.map((line, index) => {
        const w = windows[index];
        if (!w) return null;
        return (
          <Sequence
            key={`${index}-${line}`}
            from={w.startFrame}
            durationInFrames={w.durationInFrames}
          >
            {config.highlight ? (
              <HighlightStatement
                text={line}
                durationInFrames={w.durationInFrames}
                primaryColor={blockColor}
              />
            ) : (
              <FadeStatement
                text={line}
                durationInFrames={w.durationInFrames}
              />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
