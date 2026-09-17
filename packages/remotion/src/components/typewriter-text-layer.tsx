import { loadFont as loadAllura } from '@remotion/google-fonts/Allura';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { CaptionTeaseConfig } from '../types/video-config';

// Constrain to the variants we render. A bare loadFont() registers the full
// cartesian product (italic × cyrillic/vietnamese/latin-ext × all weights),
// each a separate delayRender fetch — which times out the Lambda render.
const { fontFamily: serifFamily } = loadPlayfair('normal', {
  weights: ['400', '700'],
  subsets: ['latin'],
});
const { fontFamily: scriptFamily } = loadAllura('normal', {
  weights: ['400'],
  subsets: ['latin'],
});

export interface TypewriterTextLayerProps {
  config: CaptionTeaseConfig;
  fps: number;
}

const HEADLINE_CAPTION_GAP_SECONDS = 0.35;

interface RevealedLine {
  /** How many characters of the line are visible. */
  visibleChars: number;
  /** True while this line is still revealing (cursor should blink at the end). */
  isTyping: boolean;
  /** True once this line has begun typing (i.e. should be rendered at all). */
  hasStarted: boolean;
}

const computeReveal = (
  totalChars: number,
  elapsedFrames: number,
  charsPerFrame: number
): RevealedLine => {
  if (elapsedFrames <= 0) {
    return { visibleChars: 0, isTyping: false, hasStarted: false };
  }
  const visible = Math.min(
    totalChars,
    Math.floor(elapsedFrames * charsPerFrame)
  );
  return {
    visibleChars: visible,
    isTyping: visible < totalChars,
    hasStarted: true,
  };
};

/**
 * Split the headline so the emphasis substring (if any) can be bolded inline.
 * Falls back to a single segment when emphasis is missing or not found.
 */
const splitForEmphasis = (
  headline: string,
  emphasis: string | undefined
): Array<{ text: string; bold: boolean }> => {
  if (!emphasis) return [{ text: headline, bold: false }];
  const idx = headline.indexOf(emphasis);
  if (idx === -1) return [{ text: headline, bold: false }];
  const before = headline.slice(0, idx);
  const after = headline.slice(idx + emphasis.length);
  const out: Array<{ text: string; bold: boolean }> = [];
  if (before) out.push({ text: before, bold: false });
  out.push({ text: emphasis, bold: true });
  if (after) out.push({ text: after, bold: false });
  return out;
};

/**
 * Render the first `visibleChars` characters of a segmented headline,
 * preserving the bold styling of the emphasis run.
 */
const renderHeadlineSegments = (
  segments: Array<{ text: string; bold: boolean }>,
  visibleChars: number
): React.ReactNode => {
  let consumed = 0;
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const remaining = visibleChars - consumed;
    if (remaining <= 0) break;
    const slice = seg.text.slice(0, remaining);
    consumed += slice.length;
    nodes.push(
      <span key={`seg-${i}`} style={{ fontWeight: seg.bold ? 800 : 500 }}>
        {slice}
      </span>
    );
    if (slice.length < seg.text.length) break;
  }
  return nodes;
};

/**
 * Blinking caret rendered at the end of the currently-typing line.
 * Pure CSS, 2 Hz blink — driven by current frame so it freezes in still frames consistently.
 */
const Cursor: React.FC<{ frame: number; fps: number; tall: boolean }> = ({
  frame,
  fps,
  tall,
}) => {
  // 500ms on / 500ms off
  const cycle = Math.floor((frame / fps) * 2) % 2;
  if (cycle === 1) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        width: tall ? '0.06em' : '0.05em',
        height: tall ? '0.9em' : '0.85em',
        marginLeft: '0.05em',
        verticalAlign: 'baseline',
        background: '#fff',
        transform: 'translateY(0.1em)',
      }}
    />
  );
};

/**
 * TypewriterTextLayer — caption-tease-1 organic template.
 *
 * Stacks a serif headline (with optional bolded emphasis word + trailing emoji)
 * over a cursive caption. Both reveal character-by-character at the configured
 * speed; a blinking caret follows the cursor while typing.
 */
export const TypewriterTextLayer: React.FC<TypewriterTextLayerProps> = ({
  config,
  fps,
}) => {
  const frame = useCurrentFrame();
  const { headline, emphasis, emoji, caption, charsPerSecond = 28 } = config;

  const charsPerFrame = charsPerSecond / fps;
  // Headline reveal includes the trailing emoji (counted as one "char" for pacing).
  const headlineLen = headline.length + (emoji ? 1 : 0);
  const headlineFrames = Math.ceil(headlineLen / charsPerFrame);
  const gapFrames = Math.round(HEADLINE_CAPTION_GAP_SECONDS * fps);
  const captionStart = headlineFrames + gapFrames;

  const headlineReveal = computeReveal(headlineLen, frame, charsPerFrame);
  const captionReveal = computeReveal(
    caption.length,
    frame - captionStart,
    charsPerFrame
  );

  const segments = splitForEmphasis(headline, emphasis);
  // Cap headline visible chars at the headline text length (emoji handled separately).
  const headlineTextChars = Math.min(
    headlineReveal.visibleChars,
    headline.length
  );
  const emojiVisible =
    emoji && headlineReveal.visibleChars > headline.length ? emoji : '';

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8%',
        textShadow: '0 4px 24px rgba(0, 0, 0, 0.55)',
      }}
    >
      <div style={{ textAlign: 'center', width: '100%', maxWidth: '90%' }}>
        {/* Headline (serif) */}
        {headlineReveal.hasStarted && (
          <div
            style={{
              fontFamily: `${serifFamily}, Georgia, serif`,
              fontSize: 78,
              fontWeight: 500,
              lineHeight: 1.18,
              color: '#FFFFFF',
              letterSpacing: '-0.005em',
            }}
          >
            {renderHeadlineSegments(segments, headlineTextChars)}
            {emojiVisible && (
              <span style={{ marginLeft: '0.15em' }}>{emojiVisible}</span>
            )}
            {headlineReveal.isTyping && (
              <Cursor frame={frame} fps={fps} tall={true} />
            )}
          </div>
        )}

        {/* Caption (cursive script) */}
        {captionReveal.hasStarted && (
          <div
            style={{
              marginTop: 56,
              fontFamily: `${scriptFamily}, "Brush Script MT", cursive`,
              fontSize: 84,
              fontWeight: 400,
              lineHeight: 1,
              color: '#FFFFFF',
            }}
          >
            {caption.slice(0, captionReveal.visibleChars)}
            {captionReveal.isTyping && (
              <Cursor frame={frame - captionStart} fps={fps} tall={false} />
            )}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
