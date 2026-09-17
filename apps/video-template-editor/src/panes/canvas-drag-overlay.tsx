import {
  type OverlayPlacement,
  isAnchorPlacedOverlayBlock,
} from '@borradh-workspace/video-templates';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import {
  type CSSProperties,
  type FC,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type CanvasRect,
  type ResizeHandle,
  type ScreenRect,
  pixelDeltaToPlacement,
  pixelResizeToPlacement,
  placementToRect,
  snapPlacementToGrid,
} from '../lib/canvas-coords.js';
import { setAtPath } from '../lib/node-path.js';
import { useEditorStore } from '../state.js';
import type { NodePath } from '../types.js';

// ─── Component ───────────────────────────────────────────────────────────

// Sits absolutely on top of the Player canvas. For each overlay in the
// current renderDoc, paints a transparent hit/selection rect and wires up
// dnd-kit drag-to-move + drag-to-resize that round-trip through
// store.patchDoc. Re-synth is automatic.
//
// Only renders against `doc.root.kind === 'leaf'` (overlays live on the
// leaf region only today). For `split` roots it logs once and renders
// nothing. For a null renderDoc it logs once and renders nothing.

let splitWarnedOnce = false;
let nullWarnedOnce = false;

const SELECTED_OUTLINE = '2px solid var(--accent, #4f8eff)';
const HOVER_OUTLINE = '1px solid var(--accent, #4f8eff)';

export const CanvasDragOverlay: FC = () => {
  const doc = useEditorStore((s) => s.doc);
  const renderDoc = useEditorStore((s) => s.renderDoc);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const patchDoc = useEditorStore((s) => s.patchDoc);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRect = useCanvasRect(containerRef);

  // dnd-kit: a small pointer activation threshold so single clicks select
  // without triggering drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Track shift state during drag for snap-to-grid.
  const shiftRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onDragMove = useCallback((_event: DragMoveEvent) => {
    // Visual transform is handled by each draggable via the
    // ActiveDraggableContext — no store writes during move. Drop commits.
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canvasRect) return;
      const data = event.active.data.current as DragData | undefined;
      if (!data) return;

      const next = computeNextPlacement(data, event.delta, canvasRect);
      if (!next) return;
      const final = shiftRef.current ? snapPlacementToGrid(next) : next;

      patchDoc((current) =>
        setAtPath(current, [...data.path, 'placement'], final)
      );
    },
    [canvasRect, patchDoc]
  );

  // Early-exits AFTER hooks, so hook order stays stable across renders.
  if (!renderDoc) {
    if (!nullWarnedOnce) {
      console.warn(
        '[CanvasDragOverlay] renderDoc is null; nothing to overlay.'
      );
      nullWarnedOnce = true;
    }
    return null;
  }
  if (doc.root.kind !== 'leaf') {
    if (!splitWarnedOnce) {
      console.warn(
        '[CanvasDragOverlay] split root regions are not editable in M2; rendering no overlay handles.'
      );
      splitWarnedOnce = true;
    }
    return null;
  }

  const overlayBlocks = doc.root.overlays;

  return (
    <div
      ref={containerRef}
      // Absolutely fill the Player container the parent mounts us inside.
      // Pointer events: 'auto' so we can grab; individual children control
      // whether they're hittable.
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
      // Clicking on the empty canvas clears selection.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSelection(null);
      }}
    >
      <DndContext
        sensors={sensors}
        modifiers={DRAG_MODIFIERS}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        {canvasRect &&
          overlayBlocks.map((overlay, idx) => {
            const path: NodePath = ['root', 'overlays', idx];
            // media-overlay uses its own placement model (full-bleed /
            // corner / rect), not the anchor+x/y OverlayPlacement these
            // handles drive. Narrow here so the OverlayHandle prop stays a
            // single, simple type.
            if (!isAnchorPlacedOverlayBlock(overlay)) return null;
            const isSelected = pathsEqual(selection, path);
            return (
              <OverlayHandle
                key={overlay.id}
                path={path}
                placement={overlay.placement}
                canvas={canvasRect}
                isSelected={isSelected}
                onSelect={() => setSelection(path)}
              />
            );
          })}
      </DndContext>
    </div>
  );
};

// ─── Sub-component: a single overlay's draggable body + 8 resize handles ─

interface OverlayHandleProps {
  path: NodePath;
  placement: OverlayPlacement | undefined;
  canvas: CanvasRect;
  isSelected: boolean;
  onSelect: () => void;
}

const OverlayHandle: FC<OverlayHandleProps> = ({
  path,
  placement,
  canvas,
  isSelected,
  onSelect,
}) => {
  const rect = useMemo(
    () => placementToRect(placement, canvas),
    [placement, canvas]
  );

  return (
    <>
      <DraggableBox
        path={path}
        rect={rect}
        placement={placement}
        isSelected={isSelected}
        onSelect={onSelect}
      />
      {isSelected &&
        ALL_HANDLES.map((handle) => (
          <DraggableResizeHandle
            key={handle}
            path={path}
            placement={placement}
            handle={handle}
            rect={rect}
          />
        ))}
    </>
  );
};

// ─── Draggable body ──────────────────────────────────────────────────────

interface DraggableBoxProps {
  path: NodePath;
  rect: ScreenRect;
  placement: OverlayPlacement | undefined;
  isSelected: boolean;
  onSelect: () => void;
}

const DraggableBox: FC<DraggableBoxProps> = ({
  path,
  rect,
  placement,
  isSelected,
  onSelect,
}) => {
  const id = useMemo(() => `overlay:${path.join('.')}`, [path]);
  const data: DragData = useMemo(
    () => ({ kind: 'move', path, placement }),
    [path, placement]
  );

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id, data });

  const [hovered, setHovered] = useState(false);

  const style: CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    cursor: isDragging ? 'grabbing' : 'grab',
    pointerEvents: 'auto',
    background: 'transparent',
    outline: isSelected
      ? SELECTED_OUTLINE
      : hovered
        ? HOVER_OUTLINE
        : undefined,
    outlineOffset: -1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      aria-label="overlay"
      style={style}
      onPointerDown={(e: PointerEvent) => {
        // Select on press; dnd-kit's listeners handle the actual drag once the
        // activation threshold (4px) is crossed.
        onSelect();
        listeners?.onPointerDown?.(e);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...attributes}
    />
  );
};

// ─── Draggable resize handle ─────────────────────────────────────────────

interface DraggableResizeHandleProps {
  path: NodePath;
  placement: OverlayPlacement | undefined;
  handle: ResizeHandle;
  rect: ScreenRect;
}

const HANDLE_SIZE = 10;

const DraggableResizeHandle: FC<DraggableResizeHandleProps> = ({
  path,
  placement,
  handle,
  rect,
}) => {
  const id = useMemo(
    () => `overlay-resize:${path.join('.')}:${handle}`,
    [path, handle]
  );
  const data: DragData = useMemo(
    () => ({ kind: 'resize', handle, path, placement }),
    [handle, path, placement]
  );

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id,
    data,
  });

  const { left, top } = positionForHandle(handle, rect);
  const style: CSSProperties = {
    position: 'absolute',
    left: left - HANDLE_SIZE / 2,
    top: top - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: 'var(--accent, #4f8eff)',
    border: '1px solid white',
    borderRadius: 2,
    cursor: cursorForHandle(handle),
    pointerEvents: 'auto',
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    touchAction: 'none',
    zIndex: 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onPointerDown={(e) => {
        // Don't bubble — body's onPointerDown would re-select and we don't
        // want to start the body drag.
        e.stopPropagation();
        listeners?.onPointerDown?.(e);
      }}
      {...attributes}
    />
  );
};

// ─── DragData discriminated union ────────────────────────────────────────

type DragData =
  | {
      kind: 'move';
      path: NodePath;
      placement: OverlayPlacement | undefined;
    }
  | {
      kind: 'resize';
      handle: ResizeHandle;
      path: NodePath;
      placement: OverlayPlacement | undefined;
    };

function computeNextPlacement(
  data: DragData,
  delta: { x: number; y: number },
  canvas: CanvasRect
): OverlayPlacement | null {
  if (delta.x === 0 && delta.y === 0) {
    // No real movement — if placement was previously unset, don't write
    // anything. Otherwise return the current placement so the caller can
    // decide to no-op.
    return data.placement ?? null;
  }
  if (data.kind === 'move') {
    return pixelDeltaToPlacement(data.placement, delta, canvas);
  }
  return pixelResizeToPlacement(data.placement, data.handle, delta, canvas);
}

// ─── Modifiers ───────────────────────────────────────────────────────────

const DRAG_MODIFIERS: Modifier[] = [restrictToParentElement];

// ─── Geometry helpers (handle positions / cursors) ───────────────────────

const ALL_HANDLES: ResizeHandle[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

function positionForHandle(
  handle: ResizeHandle,
  rect: ScreenRect
): { left: number; top: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const x1 = rect.left;
  const x2 = rect.left + rect.width;
  const y1 = rect.top;
  const y2 = rect.top + rect.height;
  switch (handle) {
    case 'top-left':
      return { left: x1, top: y1 };
    case 'top':
      return { left: cx, top: y1 };
    case 'top-right':
      return { left: x2, top: y1 };
    case 'left':
      return { left: x1, top: cy };
    case 'right':
      return { left: x2, top: cy };
    case 'bottom-left':
      return { left: x1, top: y2 };
    case 'bottom':
      return { left: cx, top: y2 };
    case 'bottom-right':
      return { left: x2, top: y2 };
  }
}

function cursorForHandle(handle: ResizeHandle): string {
  switch (handle) {
    case 'top-left':
    case 'bottom-right':
      return 'nwse-resize';
    case 'top-right':
    case 'bottom-left':
      return 'nesw-resize';
    case 'top':
    case 'bottom':
      return 'ns-resize';
    case 'left':
    case 'right':
      return 'ew-resize';
  }
}

// ─── Canvas-rect tracking ────────────────────────────────────────────────

// Tracks the bounding rect of the ref's *parent* element — i.e. the
// pane the overlay shares with the Player. We measure the parent so the
// overlay rect always matches the visible Player canvas.
function useCanvasRect(
  ref: RefObject<HTMLDivElement | null>
): CanvasRect | null {
  const [rect, setRect] = useState<CanvasRect | null>(null);

  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return rect;
}

// ─── Path equality ───────────────────────────────────────────────────────

function pathsEqual(a: NodePath | null, b: NodePath): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
