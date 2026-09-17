import { TemplateRenderer } from '@borradh-workspace/remotion/components';
import { Player, type PlayerRef } from '@remotion/player';
import type React from 'react';
import { useEffect, useRef } from 'react';

import { attachPlayerRef } from '../lib/player-controls';
import { useEditorStore } from '../state.js';
import { CanvasDragOverlay } from './canvas-drag-overlay';

// Logical canvas size per orientation. Player scales these to fit the container
// while preserving aspect ratio.
function dimensionsFor(orientation: 'portrait' | 'landscape' | 'square') {
  switch (orientation) {
    case 'portrait':
      return { width: 1080, height: 1920 };
    case 'landscape':
      return { width: 1920, height: 1080 };
    case 'square':
      return { width: 1080, height: 1080 };
  }
}

export const PreviewPane: React.FC = () => {
  const renderDoc = useEditorStore((s) => s.renderDoc);
  const error = useEditorStore((s) => s.error);

  if (error || !renderDoc) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            background: 'var(--bg-elev-2)',
            border: `1px solid ${error ? 'var(--error)' : 'var(--border)'}`,
            color: error ? 'var(--error)' : 'var(--fg-muted)',
            padding: 16,
            borderRadius: 6,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {error ? `Synthesis error: ${error}` : 'Waiting for first synthesis…'}
        </div>
      </div>
    );
  }

  return <PreviewBody renderDoc={renderDoc} />;
};

interface PreviewBodyProps {
  renderDoc: NonNullable<
    ReturnType<typeof useEditorStore.getState>['renderDoc']
  >;
}

const PreviewBody: React.FC<PreviewBodyProps> = ({ renderDoc }) => {
  const { width, height } = dimensionsFor(renderDoc.orientation);
  const totalFrames = Math.max(1, renderDoc.durationInFrames);

  const playerRef = useRef<PlayerRef | null>(null);
  // ref callback rather than useEffect — fires before children mount, so
  // CanvasDragOverlay sees a populated player on first paint.
  const onPlayerRef = (ref: PlayerRef | null) => {
    playerRef.current = ref;
  };
  useEffect(() => {
    return attachPlayerRef(playerRef.current);
  }, []);

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div
        style={{
          // Without an intrinsic dimension the aspectRatio alone collapses to
          // 0×0 inside flex. Fill the parent's height, let aspectRatio derive
          // the width, then clamp via max-width.
          height: '100%',
          width: 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: `${width} / ${height}`,
          position: 'relative',
        }}
      >
        <Player
          ref={onPlayerRef}
          // TemplateRenderer's props are RenderDoc-shaped; cast through unknown to
          // keep the editor independent of the renderer's exported type alias.
          component={
            TemplateRenderer as unknown as React.ComponentType<unknown>
          }
          inputProps={renderDoc as unknown as Record<string, unknown>}
          compositionWidth={width}
          compositionHeight={height}
          fps={renderDoc.fps}
          durationInFrames={totalFrames}
          controls
          clickToPlay
          loop
          style={{ width: '100%', height: '100%' }}
        />
        <CanvasDragOverlay />
      </div>
    </div>
  );
};
