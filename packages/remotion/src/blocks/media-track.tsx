import type {
  ResolvedMediaClip,
  ResolvedMediaTrackBlock,
} from '@borradh-workspace/video-templates';
import type React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  BLUR_BACKGROUND_STYLE,
  BlurPadFrame,
  CONTAIN_STYLE,
} from '../components/blur-pad-frame';
import { getTransition } from '../registries/transitions';
import type { BlockRenderer, BlockRendererProps } from './types';

// media-track — clips occupying the spine. A clip's `transition` (e.g. `fade`)
// crossfades it in over the *previous* clip: each clip's Sequence is extended
// by the transition length so it keeps painting underneath the next clip while
// that next clip fades in on top (later clips stack above earlier ones). The
// first clip has no incoming transition (nothing to fade from).

// Both branches were objectFit: 'cover'. The stock bank is overwhelmingly 16:9
// while compositions are 1080x1920 portrait, so cropping to fill discarded
// roughly half of every landscape clip — typically the half holding the hands
// and the instrument. Blur-padded instead, matching b-roll-layer.
const ClipMedia: React.FC<{
  clip: ResolvedMediaClip;
  extendFrames: number;
}> = ({ clip, extendFrames }) => {
  if (clip.mediaType === 'image') {
    return (
      <BlurPadFrame
        background={<Img src={clip.url} style={BLUR_BACKGROUND_STYLE} />}
        foreground={<Img src={clip.url} style={CONTAIN_STYLE} />}
      />
    );
  }

  const video = {
    src: clip.url,
    muted: true,
    startFrom: clip.trimStartFrames,
    // Show a little extra so the extended (underlap) tail still has frames.
    endAt: clip.trimStartFrames + clip.durationInFrames + extendFrames,
  } as const;

  return (
    <BlurPadFrame
      background={<OffthreadVideo {...video} style={BLUR_BACKGROUND_STYLE} />}
      foreground={<OffthreadVideo {...video} style={CONTAIN_STYLE} />}
    />
  );
};

interface ClipSequenceProps {
  clip: ResolvedMediaClip;
  blockStart: number;
  prevClip?: ResolvedMediaClip;
}

// Fades the clip in over `transitionFrames` (sequence-relative), then holds.
const FadeInClip: React.FC<{
  clip: ResolvedMediaClip;
  transitionFrames: number;
  extendFrames: number;
}> = ({ clip, transitionFrames, extendFrames }) => {
  const frame = useCurrentFrame();
  const opacity =
    transitionFrames > 0
      ? interpolate(frame, [0, transitionFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <ClipMedia clip={clip} extendFrames={extendFrames} />
    </AbsoluteFill>
  );
};

const ClipSequence: React.FC<ClipSequenceProps> = ({
  clip,
  blockStart,
  prevClip,
}) => {
  const { fps } = useVideoConfig();
  const localFrom = clip.startFrame - blockStart;

  const token = clip.transition;
  const entry = token ? getTransition(token) : undefined;
  const transitionFrames = entry?.durationFrames(fps) ?? 0;

  // Extend this clip's Sequence past its end so it stays painted underneath the
  // next clip's fade-in (the crossfade's outgoing layer).
  const extend = transitionFrames;

  return (
    <Sequence
      key={clip.id}
      from={Math.max(0, localFrom)}
      durationInFrames={clip.durationInFrames + extend}
    >
      <FadeInClip
        clip={clip}
        // Only fade in if there's a previous clip to fade from.
        transitionFrames={prevClip ? transitionFrames : 0}
        extendFrames={extend}
      />
    </Sequence>
  );
};

const MediaTrackComponent: React.FC<BlockRendererProps> = ({ block }) => {
  if (block.kind !== 'media-track') return null;
  const mediaBlock = block as ResolvedMediaTrackBlock;
  const { clips } = mediaBlock;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {clips.map((clip, idx) => (
        <ClipSequence
          key={clip.id}
          clip={clip}
          blockStart={mediaBlock.startFrame}
          prevClip={idx > 0 ? clips[idx - 1] : undefined}
        />
      ))}
    </AbsoluteFill>
  );
};

export const mediaTrackRenderer: BlockRenderer<ResolvedMediaTrackBlock> = {
  kind: 'media-track',
  Component: MediaTrackComponent,
};
