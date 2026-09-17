import {
  type TemplateDoc,
  templateDocSchema,
} from '@borradh-workspace/video-templates';
import { useEditorStore } from './state';

// localStorage key — bumped if the doc shape changes incompatibly.
export const AUTOSAVE_KEY = 'video-template-editor:doc:v1';

// Last-write timestamp, exposed so the toolbar can render "saved" vs "unsaved".
let lastSavedAt = 0;
export const getLastSavedAt = (): number => lastSavedAt;

/**
 * Subscribes to useEditorStore and writes the doc to localStorage on change,
 * debounced 1s. Returns an unsubscribe / teardown.
 */
export const installAutosave = (): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (doc: TemplateDoc) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc));
        lastSavedAt = Date.now();
      } catch (err) {
        console.error('[persistence] autosave failed', err);
      }
    }, 1000);
  };

  const unsubscribe = useEditorStore.subscribe((state, prev) => {
    if (state.doc !== prev.doc) {
      schedule(state.doc);
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
};

/**
 * On startup, try to restore from localStorage. Returns the parsed doc if
 * present and valid; otherwise returns the fallback. Never throws.
 */
export const loadInitialDoc = (fallback: TemplateDoc): TemplateDoc => {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return fallback;
    const json = JSON.parse(raw) as unknown;
    const parsed = templateDocSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data as TemplateDoc;
    }
    console.warn(
      '[persistence] stored doc failed schema validation, using fallback',
      parsed.error.issues
    );
    return fallback;
  } catch (err) {
    console.warn('[persistence] failed to load stored doc', err);
    return fallback;
  }
};

/**
 * Triggers a JSON download of the current doc via Blob + a[download].
 * Filename: `${doc.id}-${Date.now()}.json`.
 */
export const downloadDocAsJson = (doc: TemplateDoc): void => {
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.id}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Reads a File (from <input type="file">), parses it as JSON, validates with
 * templateDocSchema. Throws a human-readable Error on any failure.
 */
export const loadDocFromFile = async (file: File): Promise<TemplateDoc> => {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new Error(
      `Could not read file "${file.name}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `File "${file.name}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = templateDocSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') || '<root>';
    throw new Error(
      `File "${file.name}" is not a valid TemplateDoc (at ${path}: ${first?.message ?? 'unknown error'}).`
    );
  }

  return parsed.data as TemplateDoc;
};
