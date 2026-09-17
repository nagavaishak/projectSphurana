import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { useTypewriter } from './use-typewriter';

const EMPHASIS_RE = /\*\*(.+?)\*\*/g;

interface Segment {
  text: string;
  bold: boolean;
}

/** Split `**bold**` markup into ordered plain/bold segments. */
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  EMPHASIS_RE.lastIndex = 0;
  let match = EMPHASIS_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
    match = EMPHASIS_RE.exec(text);
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }
  return segments;
}

/**
 * Renders a headline string with `**bold**` inline markup as React nodes,
 * turning emphasized spans into <strong> elements. Exported for reuse by
 * slides that render Claire-authored copy outside the shell headline.
 */
export function renderEmphasis(text: string): ReactNode[] {
  return parseSegments(text).map((seg, i) =>
    seg.bold ? (
      <strong key={`seg-${i}`} className="font-bold">
        {seg.text}
      </strong>
    ) : (
      seg.text
    )
  );
}

/** The `**bold**` plain-text length (markup stripped) — for reveal math. */
function plainText(text: string): string {
  return parseSegments(text)
    .map((s) => s.text)
    .join('');
}

/**
 * Render only the first `revealed` characters of the plain text, keeping the
 * bold segments bold as they appear — so a half-typed headline still bolds
 * the right words.
 */
function renderRevealed(text: string, revealedLen: number): ReactNode[] {
  const out: ReactNode[] = [];
  let remaining = revealedLen;
  parseSegments(text).forEach((seg, i) => {
    if (remaining <= 0) return;
    const shown = seg.text.slice(0, remaining);
    remaining -= seg.text.length;
    out.push(
      seg.bold ? (
        <strong key={`seg-${i}`} className="font-bold">
          {shown}
        </strong>
      ) : (
        <span key={`seg-${i}`}>{shown}</span>
      )
    );
  });
  return out;
}

interface SlideHeadlineProps {
  text: string;
  className?: string;
  /** Type the text out character by character (Claire "speaking"). */
  typewrite?: boolean;
  /** Hold before typing starts — chains after another line. */
  startDelay?: number;
  onDone?: () => void;
}

export function SlideHeadline({
  text,
  className,
  typewrite = true,
  startDelay = 0,
  onDone,
}: SlideHeadlineProps) {
  const plain = plainText(text);
  const { revealed, done } = useTypewriter(plain, {
    speed: 22,
    startDelay,
    enabled: typewrite,
    onDone,
  });

  // Note: NO `text-balance` here — it rebalances line breaks on every
  // character as the text types, making the words jump around.
  const base = 'text-2xl leading-snug font-medium tracking-tight md:text-3xl';

  if (!typewrite) {
    return <h1 className={cn(base, className)}>{renderEmphasis(text)}</h1>;
  }

  // A full-text ghost reserves the FINAL wrapped size so nothing below shifts
  // as lines fill in; the revealed text is overlaid and wraps identically
  // (same width, same greedy wrapping).
  return (
    <h1 className={cn(base, 'relative', className)}>
      <span aria-hidden className="invisible">
        {renderEmphasis(text)}
      </span>
      <span className="absolute inset-0">
        {renderRevealed(text, revealed.length)}
        {!done && (
          <span
            aria-hidden
            className="bg-foreground ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse"
          />
        )}
      </span>
    </h1>
  );
}
