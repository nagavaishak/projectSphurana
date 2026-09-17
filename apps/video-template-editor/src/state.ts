import {
  type TemplateDoc,
  educational1,
  templateDocSchema,
} from '@borradh-workspace/video-templates';
import { create } from 'zustand';

import { PREVIEW_CONTEXT } from './fixtures/preview-context.js';
import { type StubRenderDoc, stubSynthesize } from './stub-synthesize.js';
import type { NodePath, PatchUpdater } from './types.js';

// ─── Public contract — other tracks (W-B inspector, W-C outline, W-D drag,
// W-FpH persistence/undo) consume this exact shape. Do not change shape
// without coordinating with those tracks.

export interface EditorState {
  doc: TemplateDoc;
  renderDoc: StubRenderDoc | null;
  error: string | null;
  selection: NodePath | null;
}

export interface EditorActions {
  setDoc(doc: TemplateDoc): void;
  patchDoc(updater: PatchUpdater): void;
  setSelection(path: NodePath | null): void;
  // Force re-synth (e.g. after a fixture change). Most callers don't need this
  // since setDoc/patchDoc already schedule a debounced synth.
  resynthesize(): void;
}

const SYNTH_DEBOUNCE_MS = 150;

// Single module-scoped timer keeps the debounce shared across mutators.
let synthTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSynth(get: () => EditorState, set: SetFn) {
  if (synthTimer) clearTimeout(synthTimer);
  synthTimer = setTimeout(() => {
    synthTimer = null;
    runSynth(get, set);
  }, SYNTH_DEBOUNCE_MS);
}

function runSynth(get: () => EditorState, set: SetFn) {
  const { doc } = get();
  const parsed = templateDocSchema.safeParse(doc);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path?.join('.') ?? '(root)';
    const message = firstIssue?.message ?? 'invalid TemplateDoc';
    set({
      error: `Invalid template at ${path}: ${message}`,
      renderDoc: null,
    });
    return;
  }
  const result = stubSynthesize(parsed.data as TemplateDoc, PREVIEW_CONTEXT);
  if (!result.ok) {
    set({ error: result.error, renderDoc: null });
    return;
  }
  set({ error: null, renderDoc: result.renderDoc });
}

type SetFn = (
  partial:
    | Partial<EditorState>
    | ((state: EditorState & EditorActions) => Partial<EditorState>)
) => void;

export const useEditorStore = create<EditorState & EditorActions>(
  (set, get) => {
    // Kick off initial synthesis synchronously so the Player has something to
    // render on first paint. Run on next microtask so the create() call
    // returns first.
    queueMicrotask(() => runSynth(get, set as SetFn));

    return {
      doc: educational1,
      renderDoc: null,
      error: null,
      selection: null,

      setDoc(doc) {
        set({ doc });
        scheduleSynth(get, set as SetFn);
      },
      patchDoc(updater) {
        const next = updater(get().doc);
        set({ doc: next });
        scheduleSynth(get, set as SetFn);
      },
      setSelection(path) {
        set({ selection: path });
      },
      resynthesize() {
        scheduleSynth(get, set as SetFn);
      },
    };
  }
);
