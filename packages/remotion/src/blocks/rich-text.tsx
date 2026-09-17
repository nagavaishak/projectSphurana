import type React from 'react';

// Shared inline-rich-text rendering for generic text blocks.
//
// Two concerns the plain blocks need but a bare `{text}` can't express:
//   1. **emphasis** — markdown-style `**bold**` runs are rendered bold and the
//      `**` markers are stripped (the v1 caption-tease bolded one headline
//      word; without this the markers print literally on screen).
//   2. typewriter — reveal only the first `visibleChars` characters, counting
//      across emphasis runs and ignoring the stripped markers.
//
// Generic, not template-specific: any text/list element routes through here so
// behaviour is identical everywhere and `**` never leaks to the canvas.

export interface RichSegment {
  text: string;
  bold: boolean;
}

const EMPHASIS = /\*\*([\s\S]+?)\*\*/g;

/**
 * Split a raw string into plain/bold segments on `**…**` markers. Unmatched or
 * stray `**` is left as literal text only if it doesn't form a pair — paired
 * markers are always consumed so authors never see them rendered.
 */
export function parseRichSegments(raw: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EMPHASIS.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop.
  while ((match = EMPHASIS.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: raw.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1] ?? '', bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex), bold: false });
  }
  return segments.length > 0 ? segments : [{ text: raw, bold: false }];
}

/** Total visible character count (markers excluded). */
export function visibleLength(segments: RichSegment[]): number {
  return segments.reduce((sum, s) => sum + s.text.length, 0);
}

/**
 * Render rich segments. When `visibleChars` is provided, only the first N
 * characters across all segments are shown (typewriter); when omitted the full
 * text renders. `boldWeight` defaults to a noticeable step above the base.
 */
export function renderRichSegments(
  segments: RichSegment[],
  baseWeight: number,
  visibleChars?: number
): React.ReactNode {
  const boldWeight = Math.min(900, baseWeight + 300);
  const limit = visibleChars ?? Number.POSITIVE_INFINITY;
  let consumed = 0;
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const remaining = limit - consumed;
    if (remaining <= 0) break;
    const slice = seg.text.slice(0, remaining);
    consumed += slice.length;
    nodes.push(
      <span key={i} style={seg.bold ? { fontWeight: boldWeight } : undefined}>
        {slice}
      </span>
    );
    if (slice.length < seg.text.length) break;
  }
  return nodes;
}

/**
 * Blinking caret for the typewriter entrance. Pure-CSS 2 Hz blink driven by the
 * current frame so it freezes deterministically in still frames.
 */
export const TypewriterCaret: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  if (Math.floor((frame / fps) * 2) % 2 === 1) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.06em',
        height: '0.9em',
        marginLeft: '0.04em',
        background: 'currentColor',
        transform: 'translateY(0.12em)',
      }}
    />
  );
};
