import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getCurrentFrame,
  seekTo,
  subscribeToFrame,
} from '../lib/player-controls.js';
import { useEditorStore } from '../state.js';
import type { NodePath } from '../types.js';

// ─── Visual constants ─────────────────────────────────────────────────────
// Horizontal scale. Tuned so a 10s clip @30fps is ~800px wide — comfortable
// but still lets a 30s clip fit on a 13" laptop without scrolling.
const PX_PER_FRAME = 2.5;
// Each block row gets this much vertical space; the ruler sits above and
// stays the same height regardless of how many blocks the doc carries.
const ROW_HEIGHT = 22;
const RULER_HEIGHT = 28;
// Bars are inset a hair from the row edges so adjacent rows don't visually
// merge into a single rectangle.
const ROW_GAP = 4;

const BLOCK_COLORS: Record<string, { bg: string; border: string }> = {
  'media-track': { bg: '#1e3a5f', border: '#3b82f6' },
  'staggered-list': { bg: '#5c3a17', border: '#f59e0b' },
  music: { bg: '#1d4d2e', border: '#22c55e' },
};
const DEFAULT_BLOCK_COLOR = { bg: '#2a2e36', border: '#4a4e56' };

const colorForKind = (kind: string) =>
  BLOCK_COLORS[kind] ?? DEFAULT_BLOCK_COLOR;

// ─── Path equality (kept local to avoid pulling another module in) ───────

const pathsEqual = (a: NodePath | null, b: NodePath): boolean => {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

// ─── Subscribe-to-frame hook ─────────────────────────────────────────────
// Hand-rolled so we don't need to wire `useSyncExternalStore` selectors for
// a single number; the subscription module returns an unsubscribe function
// directly.

function usePlayerFrame(): number {
  const [frame, setFrame] = useState(() => getCurrentFrame());
  useEffect(() => subscribeToFrame(setFrame), []);
  return frame;
}

// ─── Ruler ────────────────────────────────────────────────────────────────

interface RulerProps {
  totalFrames: number;
  fps: number;
  pxPerFrame: number;
  currentFrame: number;
  onSeek: (frame: number) => void;
}

const Ruler = ({
  totalFrames,
  fps,
  pxPerFrame,
  currentFrame,
  onSeek,
}: RulerProps) => {
  const width = totalFrames * pxPerFrame;
  const majorStep = Math.max(1, fps); // 1s
  const minorStep = Math.max(1, Math.floor(fps / 4)); // 1/4s

  const ticks: { frame: number; major: boolean; label?: string }[] = [];
  for (let f = 0; f <= totalFrames; f += minorStep) {
    const isMajor = f % majorStep === 0;
    ticks.push({
      frame: f,
      major: isMajor,
      label: isMajor ? `${Math.round(f / fps)}s` : undefined,
    });
  }

  const handleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.max(
      0,
      Math.min(totalFrames, Math.round(x / pxPerFrame))
    );
    onSeek(frame);
  };

  // Arrow-key nudge for accessibility. Shift = 1s jump, plain = 1 frame.
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? fps : 1;
    const delta = e.key === 'ArrowLeft' ? -step : step;
    onSeek(Math.max(0, Math.min(totalFrames, currentFrame + delta)));
  };

  return (
    <div
      role="slider"
      aria-label="Scrub timeline"
      aria-valuemin={0}
      aria-valuemax={totalFrames}
      aria-valuenow={Math.max(0, Math.min(totalFrames, currentFrame))}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        width,
        height: RULER_HEIGHT,
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: 'var(--bg-elev-2)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {ticks.map((t) => {
        const left = t.frame * pxPerFrame;
        const tickHeight = t.major ? 10 : 5;
        return (
          <div
            key={t.frame}
            style={{
              position: 'absolute',
              left,
              bottom: 0,
              width: 1,
              height: tickHeight,
              background: t.major ? 'var(--fg-muted)' : 'var(--border)',
              pointerEvents: 'none',
            }}
          >
            {t.label ? (
              <span
                style={{
                  position: 'absolute',
                  left: 3,
                  bottom: tickHeight,
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {t.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

// ─── Block bar ───────────────────────────────────────────────────────────

interface BlockBarProps {
  id: string;
  kind: string;
  startFrame: number;
  durationInFrames: number;
  pxPerFrame: number;
  rowTop: number;
  selectable: boolean;
  selected: boolean;
  onSelect?: () => void;
}

const BlockBar = ({
  id,
  kind,
  startFrame,
  durationInFrames,
  pxPerFrame,
  rowTop,
  selectable,
  selected,
  onSelect,
}: BlockBarProps) => {
  const left = startFrame * pxPerFrame;
  const width = Math.max(2, durationInFrames * pxPerFrame);
  const colors = colorForKind(kind);

  const style: CSSProperties = {
    position: 'absolute',
    left,
    top: rowTop + ROW_GAP / 2,
    width,
    height: ROW_HEIGHT - ROW_GAP,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: 3,
    boxShadow: selected ? '0 0 0 2px #ffffff' : undefined,
    color: 'var(--fg)',
    fontSize: 11,
    lineHeight: `${ROW_HEIGHT - ROW_GAP - 2}px`,
    padding: '0 6px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: selectable ? 'pointer' : 'default',
    userSelect: 'none',
  };

  if (!selectable) {
    return (
      <div style={style} title={`${id} (${kind})`}>
        {id}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      title={`${id} (${kind})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelect?.();
        }
      }}
    >
      {id}
    </div>
  );
};

// ─── Pane ─────────────────────────────────────────────────────────────────

export const TimelinePane = () => {
  const doc = useEditorStore((s) => s.doc);
  const renderDoc = useEditorStore((s) => s.renderDoc);
  const selection = useEditorStore((s) => s.selection);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Only the leaf root contributes selectable spine/overlay paths. A `split`
  // root is rendered (the timeline still shows bars from synthesis), but
  // clicking bars is disabled to avoid creating invalid selection paths.
  const rootIsLeaf = doc.root.kind === 'leaf';

  // Stable list of (id, kind) for spine/overlay derived from the live doc
  // (not renderDoc) so the order matches selection indices. Falls back to
  // renderDoc's lists when the leaf walker couldn't surface a block.
  const docSpineBlocks = useMemo(
    () => (doc.root.kind === 'leaf' ? doc.root.spine : []),
    [doc.root]
  );
  const docOverlayBlocks = useMemo(
    () => (doc.root.kind === 'leaf' ? doc.root.overlays : []),
    [doc.root]
  );

  const currentFrame = usePlayerFrame();

  if (!renderDoc) {
    return (
      <>
        <header className="pane-header">Timeline</header>
        <div style={{ padding: 12, color: 'var(--fg-muted)' }}>
          No preview — fix the synthesis error to see the timeline.
        </div>
      </>
    );
  }

  const { durationInFrames: totalFrames, fps, root } = renderDoc;
  // The renderer walks a recursive region tree, but the timeline still
  // visualises a flat lane stack. Project the first leaf — same behaviour as
  // stubSynthesize's findFirstLeaf().
  const { spine, overlays } =
    root.kind === 'leaf'
      ? { spine: root.spine, overlays: root.overlays }
      : { spine: [], overlays: [] };
  const width = Math.max(1, totalFrames) * PX_PER_FRAME;
  const hasMusic = !!renderDoc.globals.audio.music;

  // Row layout: spine rows first, then overlay rows, then optionally one
  // music row. Each row maps to a single y-band the bar slots into.
  const spineRowCount = spine.length;
  const overlayRowCount = overlays.length;
  const musicRowCount = hasMusic ? 1 : 0;
  const totalRows = spineRowCount + overlayRowCount + musicRowCount;
  const lanesHeight = Math.max(ROW_HEIGHT, totalRows * ROW_HEIGHT);

  const onSelectSpine = (i: number) => {
    if (!rootIsLeaf) return;
    useEditorStore.getState().setSelection(['root', 'spine', i]);
  };
  const onSelectOverlay = (i: number) => {
    if (!rootIsLeaf) return;
    useEditorStore.getState().setSelection(['root', 'overlays', i]);
  };

  // For each render block, find its index in the live doc list so the
  // selection path lines up. Fall back to the render order if the doc no
  // longer contains it (rare during async edits).
  const findSpineIndex = (id: string): number => {
    const i = docSpineBlocks.findIndex((b) => b.id === id);
    if (i >= 0) return i;
    return spine.findIndex((b) => b.id === id);
  };
  const findOverlayIndex = (id: string): number => {
    const i = docOverlayBlocks.findIndex((b) => b.id === id);
    if (i >= 0) return i;
    return overlays.findIndex((b) => b.id === id);
  };

  return (
    <>
      <header className="pane-header">Timeline</header>
      <div
        ref={scrollRef}
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: 'calc(100% - 32px)',
        }}
      >
        <div style={{ width, position: 'relative' }}>
          <Ruler
            totalFrames={totalFrames}
            fps={fps}
            pxPerFrame={PX_PER_FRAME}
            currentFrame={currentFrame}
            onSeek={seekTo}
          />

          <div
            style={{
              position: 'relative',
              width,
              height: lanesHeight,
              background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_HEIGHT - 1}px, var(--border) ${ROW_HEIGHT - 1}px, var(--border) ${ROW_HEIGHT}px)`,
            }}
          >
            {spine.map((b, renderIdx) => {
              const docIdx = findSpineIndex(b.id);
              const path: NodePath = ['root', 'spine', docIdx];
              return (
                <BlockBar
                  key={`spine-${b.id}-${renderIdx}`}
                  id={b.id}
                  kind={b.kind}
                  startFrame={b.startFrame}
                  durationInFrames={b.durationInFrames}
                  pxPerFrame={PX_PER_FRAME}
                  rowTop={renderIdx * ROW_HEIGHT}
                  selectable={rootIsLeaf && docIdx >= 0}
                  selected={pathsEqual(selection, path)}
                  onSelect={() => onSelectSpine(docIdx)}
                />
              );
            })}

            {overlays.map((b, renderIdx) => {
              const docIdx = findOverlayIndex(b.id);
              const path: NodePath = ['root', 'overlays', docIdx];
              return (
                <BlockBar
                  key={`overlay-${b.id}-${renderIdx}`}
                  id={b.id}
                  kind={b.kind}
                  startFrame={b.startFrame}
                  durationInFrames={b.durationInFrames}
                  pxPerFrame={PX_PER_FRAME}
                  rowTop={(spineRowCount + renderIdx) * ROW_HEIGHT}
                  selectable={rootIsLeaf && docIdx >= 0}
                  selected={pathsEqual(selection, path)}
                  onSelect={() => onSelectOverlay(docIdx)}
                />
              );
            })}

            {hasMusic && renderDoc.globals.audio.music ? (
              <BlockBar
                key="music-row"
                id={renderDoc.globals.audio.music.trackId}
                kind="music"
                startFrame={0}
                durationInFrames={totalFrames}
                pxPerFrame={PX_PER_FRAME}
                rowTop={(spineRowCount + overlayRowCount) * ROW_HEIGHT}
                selectable={false}
                selected={false}
              />
            ) : null}

            {/* Play head */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 0,
                left: Math.max(
                  0,
                  Math.min(totalFrames, currentFrame) * PX_PER_FRAME
                ),
                width: 1,
                height: lanesHeight,
                background: '#ffffff',
                boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.25)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};
