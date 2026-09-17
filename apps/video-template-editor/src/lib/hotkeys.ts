import { useEditorStore } from '../state';
import type { NodePath } from '../types';
import { getAtPath, setAtPath } from './node-path';
import { playerRef } from './player-controls';

// Step size for arrow-key nudges. Placements use 0–1 region coords, so 1% =
// 0.01. Shift multiplies by 5 → 5%.
const NUDGE_STEP = 0.01;
const NUDGE_STEP_SHIFT = 0.05;

const isEditingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
};

// Only `['root', ...path-to-overlay-block]` paths point at an overlay block
// (a TemplateOverlayBlock). The path is `['root', 'overlays', i]` for a leaf
// root, or some deeper region path ending in `['overlays', i]`. For both
// shapes we look for the segment-pair `overlays` followed by a number.
const overlayPathInfo = (
  path: NodePath
): { isOverlay: boolean; isPlacement: boolean } => {
  if (path.length < 3) return { isOverlay: false, isPlacement: false };
  // Block path: ends with ('overlays', N)
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  if (secondLast === 'overlays' && typeof last === 'number') {
    return { isOverlay: true, isPlacement: false };
  }
  // Placement path: ends with ('overlays', N, 'placement')
  if (
    path.length >= 4 &&
    last === 'placement' &&
    typeof path[path.length - 2] === 'number' &&
    path[path.length - 3] === 'overlays'
  ) {
    return { isOverlay: true, isPlacement: true };
  }
  return { isOverlay: false, isPlacement: false };
};

const blockPathFromSelection = (path: NodePath): NodePath | null => {
  const info = overlayPathInfo(path);
  if (!info.isOverlay) return null;
  if (info.isPlacement) return path.slice(0, -1);
  return path;
};

const nudgeSelectedOverlay = (
  axis: 'x' | 'y',
  direction: -1 | 1,
  shift: boolean
): boolean => {
  const { selection, doc } = useEditorStore.getState();
  if (!selection) return false;
  const blockPath = blockPathFromSelection(selection);
  if (!blockPath) return false;

  const block = getAtPath(doc, blockPath) as
    | { placement?: { x: number; y: number; anchor: string } }
    | undefined;
  if (!block) return false;

  const placement = block.placement ?? {
    anchor: 'top-left',
    x: 0,
    y: 0,
  };

  const step = (shift ? NUDGE_STEP_SHIFT : NUDGE_STEP) * direction;
  const nextValue = Math.min(
    1,
    Math.max(0, (axis === 'x' ? placement.x : placement.y) + step)
  );
  const nextPlacement = { ...placement, [axis]: nextValue };

  useEditorStore
    .getState()
    .patchDoc((current) =>
      setAtPath(current, [...blockPath, 'placement'], nextPlacement)
    );
  return true;
};

const deleteSelectedOverlay = (): boolean => {
  const { selection, doc } = useEditorStore.getState();
  if (!selection) return false;
  const blockPath = blockPathFromSelection(selection);
  if (!blockPath) return false;

  // Container path is everything up to but not including the trailing index.
  const indexSeg = blockPath[blockPath.length - 1];
  if (typeof indexSeg !== 'number') return false;
  const containerPath = blockPath.slice(0, -1);
  const list = getAtPath(doc, containerPath);
  if (!Array.isArray(list)) return false;

  const nextList = list.slice();
  nextList.splice(indexSeg, 1);
  useEditorStore
    .getState()
    .patchDoc((current) => setAtPath(current, containerPath, nextList));
  useEditorStore.getState().setSelection(null);
  return true;
};

const togglePlayPause = (): boolean => {
  const ref = playerRef.current;
  if (!ref) return false;
  if (ref.isPlaying()) ref.pause();
  else ref.play();
  return true;
};

/**
 * Installs document-level keydown handlers for the editor:
 *   - space            → play/pause
 *   - arrow keys       → nudge selected overlay placement by 1% (shift = 5%)
 *   - delete/backspace → remove selected overlay
 *
 * All handlers are no-ops while focus is in a native form control or any
 * contenteditable element. Returns an unsubscribe.
 */
export const installAppHotkeys = (): (() => void) => {
  const handler = (e: KeyboardEvent) => {
    if (isEditingTarget(e.target)) return;
    // Don't fight cmd/ctrl shortcuts (undo, save, etc.).
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case ' ':
      case 'Spacebar': {
        if (togglePlayPause()) e.preventDefault();
        return;
      }
      case 'ArrowLeft': {
        if (nudgeSelectedOverlay('x', -1, e.shiftKey)) e.preventDefault();
        return;
      }
      case 'ArrowRight': {
        if (nudgeSelectedOverlay('x', 1, e.shiftKey)) e.preventDefault();
        return;
      }
      case 'ArrowUp': {
        if (nudgeSelectedOverlay('y', -1, e.shiftKey)) e.preventDefault();
        return;
      }
      case 'ArrowDown': {
        if (nudgeSelectedOverlay('y', 1, e.shiftKey)) e.preventDefault();
        return;
      }
      case 'Delete':
      case 'Backspace': {
        if (deleteSelectedOverlay()) e.preventDefault();
        return;
      }
      default:
        return;
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
};
