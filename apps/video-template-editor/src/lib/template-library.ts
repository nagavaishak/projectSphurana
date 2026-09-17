import {
  type TemplateDoc,
  templateDocSchema,
} from '@borradh-workspace/video-templates';

// Browser-only catalog of saved templates. Lives entirely in localStorage —
// no DB, no API. Separate key from the autosaved "active doc" in
// persistence.ts so the two don't stomp each other.

export const LIBRARY_KEY = 'editor:template-library:v1';
export const MAX_ENTRIES = 50;

export interface LibraryEntry {
  id: string;
  name: string;
  doc: TemplateDoc;
  createdAt: number;
  updatedAt: number;
}

interface LibraryFile {
  entries: LibraryEntry[];
}

type LibraryListener = (entries: LibraryEntry[]) => void;

// In-tab listener set. The `storage` window event covers cross-tab updates;
// this set covers same-tab writes (which don't fire `storage`).
const listeners = new Set<LibraryListener>();

// ── Internal IO ──────────────────────────────────────────────────────

const safeReadRaw = (): unknown => {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[template-library] failed to read library', err);
    return null;
  }
};

const writeFile = (file: LibraryFile): void => {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(file));
  } catch (err) {
    console.error('[template-library] failed to persist library', err);
  }
  // Fire local listeners — the `storage` event only fires in *other* tabs.
  for (const listener of listeners) listener(file.entries.slice());
};

const isLibraryFile = (value: unknown): value is LibraryFile =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { entries?: unknown }).entries);

const parseEntries = (raw: unknown): LibraryEntry[] => {
  if (!isLibraryFile(raw)) return [];
  const out: LibraryEntry[] = [];
  for (const candidate of raw.entries) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      typeof (candidate as { id?: unknown }).id !== 'string' ||
      typeof (candidate as { name?: unknown }).name !== 'string' ||
      typeof (candidate as { createdAt?: unknown }).createdAt !== 'number' ||
      typeof (candidate as { updatedAt?: unknown }).updatedAt !== 'number'
    ) {
      continue;
    }
    const parsed = templateDocSchema.safeParse(
      (candidate as { doc?: unknown }).doc
    );
    if (!parsed.success) continue;
    const entry = candidate as LibraryEntry;
    out.push({
      id: entry.id,
      name: entry.name,
      doc: parsed.data as TemplateDoc,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  return out;
};

// Newest first.
const sortByUpdatedDesc = (entries: LibraryEntry[]): LibraryEntry[] =>
  entries.slice().sort((a, b) => b.updatedAt - a.updatedAt);

// Cap at MAX_ENTRIES, evicting the oldest (least-recently-updated). The list
// passed in is already sorted newest-first by callers, so we just slice.
const evictExcess = (entries: LibraryEntry[]): LibraryEntry[] =>
  entries.length <= MAX_ENTRIES ? entries : entries.slice(0, MAX_ENTRIES);

const readEntries = (): LibraryEntry[] =>
  sortByUpdatedDesc(parseEntries(safeReadRaw()));

// ── Public API ────────────────────────────────────────────────────────

export const loadLibrary = (): LibraryEntry[] => readEntries();

export const saveEntry = (name: string, doc: TemplateDoc): LibraryEntry => {
  const now = Date.now();
  const entry: LibraryEntry = {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2, 10)}`,
    name: name.trim() || 'Untitled',
    doc,
    createdAt: now,
    updatedAt: now,
  };
  const next = evictExcess(sortByUpdatedDesc([entry, ...readEntries()]));
  writeFile({ entries: next });
  return entry;
};

export const updateEntry = (
  id: string,
  patch: Partial<{ name: string; doc: TemplateDoc }>
): LibraryEntry | null => {
  const entries = readEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const prev = entries[idx];
  if (!prev) return null;
  const updated: LibraryEntry = {
    ...prev,
    name: patch.name !== undefined ? patch.name.trim() || prev.name : prev.name,
    doc: patch.doc ?? prev.doc,
    updatedAt: Date.now(),
  };
  const rest = entries.filter((e) => e.id !== id);
  const next = evictExcess(sortByUpdatedDesc([updated, ...rest]));
  writeFile({ entries: next });
  return updated;
};

export const deleteEntry = (id: string): void => {
  const entries = readEntries();
  if (!entries.some((e) => e.id === id)) return;
  const next = entries.filter((e) => e.id !== id);
  writeFile({ entries: next });
};

export const duplicateEntry = (id: string): LibraryEntry | null => {
  const entries = readEntries();
  const source = entries.find((e) => e.id === id);
  if (!source) return null;
  return saveEntry(`${source.name} (copy)`, source.doc);
};

/**
 * Subscribes to library changes from this tab and `storage` events from
 * other tabs. The callback receives a fresh sorted list. Returns an
 * unsubscribe.
 */
export const subscribeLibrary = (cb: LibraryListener): (() => void) => {
  listeners.add(cb);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== LIBRARY_KEY && e.key !== null) return;
    cb(readEntries());
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
};
