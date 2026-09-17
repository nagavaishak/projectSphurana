import type { TemplateDoc } from '@borradh-workspace/video-templates';
import { useEditorStore } from './state';

const MAX_HISTORY = 100;

// Past stack: oldest → most-recent (excluding current).
// Future stack: most-recent-undone first.
const past: TemplateDoc[] = [];
const future: TemplateDoc[] = [];

// When we apply an undo/redo we mutate the store ourselves; the subscription
// would otherwise loop those changes back into the past stack. This flag tells
// the subscriber to skip those self-induced changes.
let suppressNextPush = false;

export const canUndo = (): boolean => past.length > 0;
export const canRedo = (): boolean => future.length > 0;

const applyDoc = (doc: TemplateDoc): void => {
  suppressNextPush = true;
  useEditorStore.getState().setDoc(doc);
};

/**
 * Subscribes to useEditorStore.doc changes. On every "user" change pushes the
 * previous doc onto the past stack (cap MAX_HISTORY) and clears the future
 * stack. Skips pushes triggered by undo()/redo() themselves.
 * Returns an unsubscribe.
 */
export const installUndoStack = (): (() => void) => {
  return useEditorStore.subscribe((state, prev) => {
    if (state.doc === prev.doc) return;

    if (suppressNextPush) {
      suppressNextPush = false;
      return;
    }

    past.push(prev.doc);
    if (past.length > MAX_HISTORY) {
      past.shift();
    }
    // Any new user edit invalidates the redo stack.
    future.length = 0;
  });
};

export const undo = (): void => {
  const previous = past.pop();
  if (!previous) return;
  const current = useEditorStore.getState().doc;
  future.unshift(current);
  applyDoc(previous);
};

export const redo = (): void => {
  const next = future.shift();
  if (!next) return;
  const current = useEditorStore.getState().doc;
  past.push(current);
  if (past.length > MAX_HISTORY) {
    past.shift();
  }
  applyDoc(next);
};

const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
};

/**
 * Installs document-level keydown listeners for cmd-z / cmd-shift-z (and
 * ctrl-z / ctrl-shift-z on non-mac). Returns an unsubscribe.
 */
export const installUndoHotkeys = (): (() => void) => {
  const mac = isMac();
  const handler = (e: KeyboardEvent) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    if (e.key !== 'z' && e.key !== 'Z') return;

    // Skip when the user is typing in a contenteditable / native control —
    // textareas have their own undo and we don't want to fight them.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
    }

    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
};

// Test-only / safety helper. Useful when loading a fresh doc (file load,
// reset) — we don't want undo to roll back to the old doc across boundaries.
export const clearUndoHistory = (): void => {
  past.length = 0;
  future.length = 0;
};
