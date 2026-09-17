import type { ResolvedSolidBlock } from '@borradh-workspace/video-templates';
import type React from 'react';
import { AbsoluteFill } from 'remotion';

import type { BlockRenderer, BlockRendererProps } from './types';

// solid — paints a single colour or gradient into its spine slot. The colour
// field accepts any CSS background string (a hex, an rgb()/rgba(), or a
// `linear-gradient(…)` literal), so the same block covers both flat fills and
// "background plate" overlays without needing two kinds.

const SolidComponent: React.FC<BlockRendererProps> = ({ block }) => {
  if (block.kind !== 'solid') return null;
  const solid = block as ResolvedSolidBlock;
  return <AbsoluteFill style={{ background: solid.color }} />;
};

export const solidRenderer: BlockRenderer<ResolvedSolidBlock> = {
  kind: 'solid',
  Component: SolidComponent,
};
