import type { ResolvedTextBlock } from '@borradh-workspace/video-templates';
import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { getAnimationPreset } from '../registries/animations';
import {
  TypewriterCaret,
  parseRichSegments,
  renderRichSegments,
  visibleLength,
} from './rich-text';
import {
  applyResolvedTypeStyle,
  overlayPlacementToStyle,
  textBoxStyle,
} from './style-helpers';
import type { BlockRenderer, BlockRendererProps } from './types';

// text — a single text overlay with a compile-resolved type style and a
// render-time animation lookup. Centered fallback when no placement is given.
//
// Inline `**emphasis**` is rendered bold (markers stripped) for every entrance.
// The `typewriter` entrance reveals characters over `entranceDurationFrames`
// with a blinking caret while typing; all entrances honour `entranceDelayFrames`
// (the element is hidden until the delay elapses, then animates from frame 0).

const TextComponent: React.FC<BlockRendererProps> = ({ block, ctx }) => {
  if (block.kind !== 'text') return null;
  const text = block as ResolvedTextBlock;
  const rawFrame = useCurrentFrame();
  const delay = text.entranceDelayFrames ?? 0;
  const frame = rawFrame - delay;

  if (frame < 0) return null;

  const entranceFrames = text.entranceDurationFrames ?? 12;
  const segments = parseRichSegments(text.text);
  const baseWeight = text.typeStyle.fontWeight;
  const isTypewriter = text.entrance === 'typewriter';

  const preset = getAnimationPreset(text.entrance);
  const entrance = preset(frame, entranceFrames, ctx.fps);

  // Typewriter: slice characters by the preset's 0–1 progress; show a caret
  // while still typing. Other entrances render the full styled text.
  let content: React.ReactNode;
  if (isTypewriter) {
    const total = visibleLength(segments);
    const progress = entrance.progress ?? 1;
    const visibleChars = Math.floor(progress * total);
    const stillTyping = visibleChars < total;
    content = (
      <>
        {renderRichSegments(segments, baseWeight, visibleChars)}
        {stillTyping && <TypewriterCaret frame={frame} fps={ctx.fps} />}
      </>
    );
  } else {
    content = renderRichSegments(segments, baseWeight);
  }

  const placement = text.placement
    ? overlayPlacementToStyle(text.placement)
    : null;

  const body = (
    <div
      style={{
        opacity: entrance.opacity,
        transform: entrance.transform,
        clipPath: isTypewriter ? undefined : entrance.clipPath,
        textAlign: 'center',
        maxWidth: '92%',
      }}
    >
      <span
        style={{
          ...applyResolvedTypeStyle(text.typeStyle),
          ...textBoxStyle(text.container, text.typeStyle),
          display: 'inline-block',
        }}
      >
        {content}
      </span>
    </div>
  );

  if (placement) {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={placement}>{body}</div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {body}
    </AbsoluteFill>
  );
};

export const textRenderer: BlockRenderer<ResolvedTextBlock> = {
  kind: 'text',
  Component: TextComponent,
};
