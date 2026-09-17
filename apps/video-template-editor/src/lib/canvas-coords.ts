import type {
  OverlayAnchor,
  OverlayPlacement,
} from '@borradh-workspace/video-templates';

// Pure coordinate helpers for the WYSIWYG overlay layer.
//
// Two coordinate spaces:
//   • placement: region-relative, 0–1 normalised, anchor-aware.
//   • rect:      screen pixels relative to the canvas (Player) rect.
//
// These match `placementToStyle()` in @borradh-workspace/remotion's
// template-renderer.tsx so what the user drags matches what gets painted.

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasRect {
  width: number;
  height: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────

// When an overlay has no placement, the renderer paints it full-bleed. We
// pick a sensible centered default the moment the user first drags so the
// drop position is honest.
export const centeredDefaultPlacement = (): OverlayPlacement => ({
  anchor: 'center',
  x: 0.5,
  y: 0.5,
});

// Heuristic default size used while computing the initial screen rect of an
// overlay that has no width/height set. The renderer would stretch it
// auto, but for the click target we need *some* hit box. 60% × 40% mimics
// the typical staggered-list footprint.
const DEFAULT_HIT_WIDTH = 0.6;
const DEFAULT_HIT_HEIGHT = 0.4;

// ─── placement → rect ────────────────────────────────────────────────────

const horizontalOf = (a: OverlayAnchor): 'left' | 'right' | 'center' =>
  a.includes('left') ? 'left' : a.includes('right') ? 'right' : 'center';

const verticalOf = (a: OverlayAnchor): 'top' | 'bottom' | 'center' =>
  a.startsWith('top') ? 'top' : a.startsWith('bottom') ? 'bottom' : 'center';

/**
 * Convert a placement (or `undefined` for "use defaults") into a screen rect
 * relative to the canvas. Mirrors `placementToStyle()` in the renderer.
 */
export const placementToRect = (
  placement: OverlayPlacement | undefined,
  canvas: CanvasRect
): ScreenRect => {
  const p = placement ?? centeredDefaultPlacement();
  const w = (p.width ?? DEFAULT_HIT_WIDTH) * canvas.width;
  const h = (p.height ?? DEFAULT_HIT_HEIGHT) * canvas.height;

  const horizontal = horizontalOf(p.anchor);
  const vertical = verticalOf(p.anchor);

  let left: number;
  if (horizontal === 'left') left = p.x * canvas.width;
  else if (horizontal === 'right') left = p.x * canvas.width - w;
  else left = p.x * canvas.width - w / 2;

  let top: number;
  if (vertical === 'top') top = p.y * canvas.height;
  else if (vertical === 'bottom') top = p.y * canvas.height - h;
  else top = p.y * canvas.height - h / 2;

  return { left, top, width: w, height: h };
};

/**
 * Inverse of placementToRect — given a screen rect on the canvas and the
 * anchor the placement should keep, compute the (x, y[, w, h]) that puts the
 * overlay there. width/height are emitted only if the input rect differs from
 * the canvas-spanning default for that axis, so we don't accidentally pin a
 * size the user didn't choose.
 */
export const rectToPlacement = (
  rect: ScreenRect,
  canvas: CanvasRect,
  anchor: OverlayAnchor,
  previous?: OverlayPlacement
): OverlayPlacement => {
  const horizontal = horizontalOf(anchor);
  const vertical = verticalOf(anchor);

  let x: number;
  if (horizontal === 'left') x = rect.left / canvas.width;
  else if (horizontal === 'right') x = (rect.left + rect.width) / canvas.width;
  else x = (rect.left + rect.width / 2) / canvas.width;

  let y: number;
  if (vertical === 'top') y = rect.top / canvas.height;
  else if (vertical === 'bottom') y = (rect.top + rect.height) / canvas.height;
  else y = (rect.top + rect.height / 2) / canvas.height;

  // Preserve width/height only if the previous placement had them set, OR if
  // they differ meaningfully from the default heuristic. This keeps drag-only
  // operations from synthesising a fixed size.
  const next: OverlayPlacement = { anchor, x: clamp01(x), y: clamp01(y) };
  if (previous?.width !== undefined) {
    next.width = clamp01(rect.width / canvas.width);
  }
  if (previous?.height !== undefined) {
    next.height = clamp01(rect.height / canvas.height);
  }
  return next;
};

/**
 * Apply a pixel-space drag delta to an existing placement (or a centered
 * default if none) and return the next placement. width/height are preserved.
 */
export const pixelDeltaToPlacement = (
  currentPlacement: OverlayPlacement | undefined,
  pixelDelta: { x: number; y: number },
  canvas: CanvasRect
): OverlayPlacement => {
  const base = currentPlacement ?? centeredDefaultPlacement();
  // Canvas isn't measured yet (ResizeObserver hasn't fired) — refuse the patch.
  if (canvas.width <= 0 || canvas.height <= 0) return base;
  const startRect = placementToRect(base, canvas);
  const movedRect: ScreenRect = {
    left: startRect.left + pixelDelta.x,
    top: startRect.top + pixelDelta.y,
    width: startRect.width,
    height: startRect.height,
  };
  return rectToPlacement(movedRect, canvas, base.anchor, base);
};

/**
 * Resize an overlay by dragging one of 8 handles. The opposite edge stays
 * pinned; the dragged corner/edge follows the pixel delta.
 */
export type ResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

const MIN_SIZE_PX = 24;

export const pixelResizeToPlacement = (
  currentPlacement: OverlayPlacement | undefined,
  handle: ResizeHandle,
  pixelDelta: { x: number; y: number },
  canvas: CanvasRect
): OverlayPlacement => {
  const base = currentPlacement ?? centeredDefaultPlacement();
  const startRect = placementToRect(base, canvas);

  let { left, top, width, height } = startRect;

  const movesLeft = handle.includes('left');
  const movesRight = handle.includes('right');
  const movesTop = handle.startsWith('top');
  const movesBottom = handle.startsWith('bottom');

  if (movesLeft) {
    const newLeft = Math.min(left + pixelDelta.x, left + width - MIN_SIZE_PX);
    width = width + (left - newLeft);
    left = newLeft;
  } else if (movesRight) {
    width = Math.max(MIN_SIZE_PX, width + pixelDelta.x);
  }

  if (movesTop) {
    const newTop = Math.min(top + pixelDelta.y, top + height - MIN_SIZE_PX);
    height = height + (top - newTop);
    top = newTop;
  } else if (movesBottom) {
    height = Math.max(MIN_SIZE_PX, height + pixelDelta.y);
  }

  // Clamp inside the canvas.
  if (left < 0) {
    width += left;
    left = 0;
  }
  if (top < 0) {
    height += top;
    top = 0;
  }
  if (left + width > canvas.width) width = canvas.width - left;
  if (top + height > canvas.height) height = canvas.height - top;

  // Resize always writes both width AND height — the user is asking for a
  // specific size, so force them onto the placement even if previously unset.
  const next = rectToPlacement(
    { left, top, width, height },
    canvas,
    base.anchor,
    base
  );
  next.width = clamp01(width / canvas.width);
  next.height = clamp01(height / canvas.height);
  return next;
};

// ─── Utilities ───────────────────────────────────────────────────────────

// NaN-safe clamp. A zero-width canvas (mid-mount, before ResizeObserver
// fires) produces NaN/Infinity in rectToPlacement; without this guard those
// poison the placement and the Zod schema rejects the next synth.
const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

// Snap a region-relative value to the nearest 5% grid step. Used when the
// user holds shift during drag.
export const SNAP_STEP = 0.05;
export const snapToGrid = (n: number, step = SNAP_STEP): number =>
  Math.round(n / step) * step;

export const snapPlacementToGrid = (
  placement: OverlayPlacement,
  step = SNAP_STEP
): OverlayPlacement => ({
  ...placement,
  x: clamp01(snapToGrid(placement.x, step)),
  y: clamp01(snapToGrid(placement.y, step)),
  width:
    placement.width !== undefined
      ? clamp01(snapToGrid(placement.width, step))
      : undefined,
  height:
    placement.height !== undefined
      ? clamp01(snapToGrid(placement.height, step))
      : undefined,
});
