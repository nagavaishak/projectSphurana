import type {
  ResolvedOverlayPlacement,
  ResolvedStaggeredListBlock,
  ResolvedTextElement,
} from '@borradh-workspace/video-templates';
import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { getAnimationPreset, wordRevealStyle } from '../registries/animations';
import { parseRichSegments, renderRichSegments } from './rich-text';
import { applyResolvedTypeStyle, textBoxStyle } from './style-helpers';
import type { BlockRenderer, BlockRendererProps } from './types';

// staggered-list — a generic vertical list primitive. The lead (e.g. hook)
// renders first, then items one-per-`beatsPerItemFrames`, then the trail (CTA).
//
// Generic, data-driven knobs (no template-specific code):
//  - reveal 'accumulate' (default) keeps prior items on screen; 'sequential'
//    shows one element at a time (v1 text-frame interstitials).
//  - numbered draws an index badge before each item (v1 numbered-list).
// Type styling is applied verbatim from the resolved style; container chrome
// (pill/button/plate) lives in style-helpers.

function placementToStyle(
  p: ResolvedOverlayPlacement | undefined
): React.CSSProperties {
  if (!p) return {};

  const pct = (n: number) => `${n * 100}%`;
  const style: React.CSSProperties = { position: 'absolute' };

  if (p.width !== undefined) style.width = pct(p.width);
  if (p.height !== undefined) style.height = pct(p.height);

  const horizontal = p.anchor.includes('left')
    ? 'left'
    : p.anchor.includes('right')
      ? 'right'
      : 'center';
  const vertical = p.anchor.startsWith('top')
    ? 'top'
    : p.anchor.startsWith('bottom')
      ? 'bottom'
      : 'center';

  if (horizontal === 'left') style.left = pct(p.x);
  else if (horizontal === 'right') style.right = pct(1 - p.x);
  else {
    style.left = pct(p.x);
    style.transform = `translateX(-50%)${style.transform ?? ''}`;
  }

  if (vertical === 'top') style.top = pct(p.y);
  else if (vertical === 'bottom') style.bottom = pct(1 - p.y);
  else {
    style.top = pct(p.y);
    style.transform = `translateY(-50%) ${style.transform ?? ''}`.trim();
  }

  return style;
}

const StaggeredListComponent: React.FC<BlockRendererProps> = ({
  block,
  ctx,
}) => {
  if (block.kind !== 'staggered-list') return null;
  const list = block;
  const { fps, orientation } = ctx;
  const isPortrait = orientation === 'portrait';
  const sequential = list.reveal === 'sequential';

  // Display order: lead → items → trail. Sequential reveal uses each element's
  // entranceFrame to know when the next one replaces it. Only items carry an
  // index badge (numbered); lead/trail never do.
  const ordered: Array<{ element: ResolvedTextElement; badge?: number }> = [
    ...(list.lead ? [{ element: list.lead }] : []),
    ...list.items.map((element, i) => ({
      element,
      badge: list.numbered ? i + 1 : undefined,
    })),
    ...(list.trail ? [{ element: list.trail }] : []),
  ];

  // Horizontal alignment (v1 numbered-list is left). Default centered.
  const hAlign = list.hAlign ?? 'center';
  const crossAxis =
    hAlign === 'left'
      ? 'flex-start'
      : hAlign === 'right'
        ? 'flex-end'
        : 'center';
  const textAlign = hAlign === 'center' ? 'center' : hAlign;

  // A placement that's anything other than dead-centre means the template wants
  // this list positioned as a SECTION (e.g. ins-outs' title / INS / OUTS bands).
  // A centred placement (or none) keeps the original full-screen-centred layout
  // so existing single-list templates render unchanged.
  const p = list.placement;
  const positioned =
    !!p && !(p.anchor === 'center' && p.x === 0.5 && p.y === 0.5);

  const elements = ordered.map(({ element, badge }, i) => (
    <ElementSlot
      key={element.id}
      element={element}
      fps={fps}
      badge={badge}
      textAlign={textAlign}
      // Accumulate lists reserve each item's space from the start (render it
      // invisible until its turn) so the column doesn't reflow/re-center as
      // items appear — they fade in PLACE instead of shifting everything up.
      // Sequential lists show one element at a time, so they don't reserve.
      reserveSpace={!sequential}
      exitFrame={
        sequential
          ? (ordered[i + 1]?.element.entranceFrame ?? Number.POSITIVE_INFINITY)
          : undefined
      }
    />
  ));

  if (positioned) {
    // Content-height block anchored at the placement; no forced full height so
    // multiple sections can stack without overlapping.
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={placementToStyle(p)}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: crossAxis,
              // Tight grouping so a label + its items read as one block (v1).
              gap: isPortrait ? 4 : 4,
              width: '100%',
            }}
          >
            {elements}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  const body = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: crossAxis,
        padding: isPortrait ? '15% 48px 10% 48px' : '8% 120px 6% 120px',
        gap: isPortrait ? 28 : 22,
        width: '100%',
        height: '100%',
      }}
    >
      {elements}
    </div>
  );

  return <AbsoluteFill style={{ pointerEvents: 'none' }}>{body}</AbsoluteFill>;
};

// White badge with a dark number (v1 numbered-list). The number colour is the
// badge's own contrast colour — independent of the item text colour, which is
// usually white over footage.
const NumberBadge: React.FC<{ n: number }> = ({ n }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      width: 48,
      height: 48,
      borderRadius: 12,
      background: '#FFFFFF',
      color: '#111111',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 800,
      fontSize: 26,
    }}
  >
    {n}
  </span>
);

const ElementSlot: React.FC<{
  element: ResolvedTextElement;
  fps: number;
  badge?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** When true, render (invisible) before the entrance so the slot holds its
   *  space and the list doesn't reflow as items appear. */
  reserveSpace?: boolean;
  /** Absolute frame at which this element disappears (sequential mode). */
  exitFrame?: number;
}> = ({
  element,
  fps,
  badge,
  textAlign = 'center',
  reserveSpace = false,
  exitFrame,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - element.entranceFrame;
  // Before the entrance: drop it entirely (sequential, one-at-a-time) or keep
  // it in the layout but invisible (accumulate, so the column doesn't reflow).
  if (localFrame < 0 && !reserveSpace) return null;
  if (exitFrame !== undefined && frame >= exitFrame) return null;

  const preset = getAnimationPreset(element.entrance);
  const entrance = preset(
    localFrame,
    element.entranceDurationFrames ?? 12,
    fps
  );

  const baseSpanStyle = {
    ...applyResolvedTypeStyle(element.typeStyle),
    ...textBoxStyle(element.container, element.typeStyle),
    display: 'inline-block' as const,
  };
  // Parse `**emphasis**` so markers never print and bold runs survive both the
  // word-by-word and static paths. Word reveal carries the per-word bold flag.
  const segments = parseRichSegments(element.text);
  const baseWeight = element.typeStyle.fontWeight;
  const boldWeight = Math.min(900, baseWeight + 300);
  const words = segments.flatMap((seg) =>
    seg.text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ word, bold: seg.bold }))
  );
  const textSpan =
    element.entrance === 'word-by-word' ? (
      <span style={baseSpanStyle}>
        {words.map(({ word, bold }, i) => {
          const reveal = wordRevealStyle(i, localFrame);
          return (
            <span
              key={`${word}-${i}`}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                fontWeight: bold ? boldWeight : undefined,
                opacity: reveal.opacity,
                transform: reveal.transform,
              }}
            >
              {i === words.length - 1 ? word : `${word} `}
            </span>
          );
        })}
      </span>
    ) : (
      <span style={baseSpanStyle}>
        {renderRichSegments(segments, baseWeight)}
      </span>
    );

  // Optional kicker (e.g. "IMPROVES:") rendered above the item text.
  const kicker = element.kicker;
  const content = kicker ? (
    <div>
      <div
        style={{
          ...applyResolvedTypeStyle(kicker.typeStyle),
          marginBottom: 8,
        }}
      >
        {kicker.text}
      </div>
      {textSpan}
    </div>
  ) : (
    textSpan
  );

  return (
    <div
      style={{
        opacity: entrance.opacity,
        transform: entrance.transform,
        clipPath: entrance.clipPath,
        display: badge !== undefined ? 'flex' : 'block',
        alignItems: 'center',
        gap: 20,
        textAlign,
        maxWidth: '92%',
      }}
    >
      {badge !== undefined && <NumberBadge n={badge} />}
      {content}
    </div>
  );
};

export const staggeredListRenderer: BlockRenderer<ResolvedStaggeredListBlock> =
  {
    kind: 'staggered-list',
    Component: StaggeredListComponent,
  };
