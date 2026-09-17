/**
 * INLINE EDIT — the pure half.
 *
 * Everything in this file is a pure function so it can be unit tested without a
 * browser: which fields are editable, what the renderer emits for them, what a
 * committed value is allowed to contain, and which `postMessage` events are
 * allowed to be believed. The DOM wiring lives in `edit-runtime.ts`, which does
 * nothing but call into here.
 *
 * See docs/plans/microsites-inline-edit-contract.md. The two rules that must
 * never be relaxed:
 *
 * 1. NOTHING here may be emitted on a published render. `editableAttrs()`
 *    returns an empty object when `editable` is false, and the runtime module
 *    is only ever imported by the token-gated preview route.
 * 2. A committed value is TEXT. `contenteditable` accepts pasted HTML, and this
 *    string is written to `blocks` jsonb and rendered later to the public, so
 *    the commit path reads `textContent` and passes it through
 *    `sanitizeEditableText` regardless of what `plaintext-only` claims to have
 *    enforced (Firefox has historically ignored it and fallen back to `true`).
 */

import type { BlockType } from '@borradh-workspace/web-shared';

/**
 * §2 of the contract, verbatim. PLAIN-TEXT PROPS ONLY.
 *
 * Data-bound content — a service name, a practitioner's name, opening hours —
 * is deliberately absent. Those nodes belong to business records; an inline
 * edit here would either drift from the record or silently rewrite it from a
 * website editor. They get no affordance at all rather than a disabled one.
 */
export const EDITABLE_FIELDS = {
  hero: ['headline', 'subheadline', 'ctaLabel'],
  services: ['title', 'intro'],
  team: ['title', 'intro'],
  gallery: ['title'],
  opening_hours: ['title'],
  map_location: ['title'],
  cta_booking: ['headline', 'subtext', 'buttonLabel'],
  rich_text: ['markdown'],
} as const satisfies Record<BlockType, readonly [string, ...string[]]>;

export type EditableField<T extends BlockType = BlockType> =
  (typeof EDITABLE_FIELDS)[T][number];

/** The only multi-line field. Enter inserts a newline instead of committing. */
export const MULTILINE_FIELDS = new Set<string>(['markdown']);

/** Longest committed value. Generous, but not unbounded — jsonb has to hold it. */
export const MAX_SINGLE_LINE = 2_000;
export const MAX_MULTILINE = 20_000;

export const isMultilineField = (field: string): boolean =>
  MULTILINE_FIELDS.has(field);

/** Is `field` editable on this block type? Unknown types are never editable. */
export const isEditableField = (
  type: string | undefined,
  field: string
): boolean => {
  const fields = (EDITABLE_FIELDS as Record<string, readonly string[]>)[
    type ?? ''
  ];
  return !!fields && fields.includes(field);
};

export const editableFieldsFor = (
  type: string | undefined
): readonly string[] =>
  (EDITABLE_FIELDS as Record<string, readonly string[]>)[type ?? ''] ?? [];

export interface EditableAttrs {
  'data-ms-editable'?: string;
  'data-ms-block'?: string;
  'data-ms-field'?: string;
  contenteditable?: string;
}

/**
 * The §3 markup, or NOTHING.
 *
 * A published render calls this with `editable === false` and gets `{}` — no
 * `contenteditable`, no data attributes. It also returns `{}` when the block
 * has no id (jsonb makes that possible) or the field is not in §2, so a bad
 * block cannot open an editing surface the canvas has no way to commit.
 */
export const editableAttrs = (
  editable: boolean,
  blockId: string | undefined,
  blockType: string | undefined,
  field: string
): EditableAttrs => {
  if (!editable) return {};
  if (!blockId || typeof blockId !== 'string') return {};
  if (!isEditableField(blockType, field)) return {};

  return {
    'data-ms-editable': '',
    'data-ms-block': blockId,
    'data-ms-field': field,
    // `plaintext-only` where supported; the commit path sanitises regardless.
    contenteditable: 'plaintext-only',
  };
};

/**
 * Characters that must never survive a commit: C0/C1 controls, zero-width
 * joiners and the bidi overrides. None of them are typeable copy, all of them
 * are used to disguise text.
 */
const CONTROL_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * TEXT IN, TEXT OUT.
 *
 * Called on every commit with the node's `textContent` — never its
 * `innerHTML`. Markup pasted into a `contenteditable` becomes real DOM nodes,
 * so `textContent` already flattens `<img onerror>` to its text; this then
 * removes the characters that let a string lie about what it is.
 */
export const sanitizeEditableText = (
  raw: string | null | undefined,
  options: { multiline?: boolean } = {}
): string => {
  const multiline = options.multiline ?? false;
  let value = String(raw ?? '');

  value = value.replace(/\r\n?/g, '\n');
  value = value.replace(CONTROL_CHARS, '');
  value = value.replace(INVISIBLE_CHARS, '');
  // Non-breaking spaces come from the browser's own contenteditable padding,
  // not from the user, and round-trip as literal   into jsonb.
  value = value.replace(/\u00A0/g, ' ');

  if (multiline) {
    value = value.replace(/[^\S\n]+/g, ' ');
    value = value
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n');
    return value.trim().slice(0, MAX_MULTILINE);
  }

  value = value.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  return value.trim().slice(0, MAX_SINGLE_LINE);
};

/**
 * No commit when the value is unchanged. A focus/blur with no typing must not
 * create a revision — the history is what "N changes since last publish"
 * counts, and noise makes that number meaningless.
 *
 * Compared AFTER sanitising both sides, so re-typing the same word with a
 * stray non-breaking space is also a no-op.
 */
export const hasChanged = (
  original: string | null | undefined,
  next: string | null | undefined,
  options: { multiline?: boolean } = {}
): boolean =>
  sanitizeEditableText(original, options) !==
  sanitizeEditableText(next, options);

/* ------------------------------------------------------------------ */
/* Messages (§4)                                                       */
/* ------------------------------------------------------------------ */

export const EDITOR_SOURCE = 'microsite-editor' as const;
export const CANVAS_SOURCE = 'microsite-canvas' as const;

export type EditorMessage =
  | { source: typeof EDITOR_SOURCE; type: 'ready' }
  | { source: typeof EDITOR_SOURCE; type: 'selected'; blockId: string }
  | {
      source: typeof EDITOR_SOURCE;
      type: 'edit';
      blockId: string;
      field: string;
      value: string;
    }
  | {
      source: typeof EDITOR_SOURCE;
      type: 'dirty';
      blockId: string;
      field: string;
    };

export type CanvasMessage =
  | { source: typeof CANVAS_SOURCE; type: 'enable-edit' }
  | {
      source: typeof CANVAS_SOURCE;
      type: 'commit-ok';
      blockId: string;
      field: string;
    }
  | {
      source: typeof CANVAS_SOURCE;
      type: 'commit-failed';
      blockId: string;
      field: string;
      message?: string;
    };

/**
 * An iframe that accepts unvalidated `postMessage` is the standard way this
 * feature becomes a vulnerability, so the origin is compared as an exact
 * string against the ONE expected peer. `'*'` and `'null'` (a sandboxed or
 * `data:` document) are never trusted, and an empty expectation trusts nobody
 * rather than everybody — a missing config value must fail closed.
 */
export const isTrustedOrigin = (
  origin: string | null | undefined,
  expected: string | null | undefined
): boolean => {
  if (!origin || !expected) return false;
  if (origin === '*' || origin === 'null') return false;
  if (expected === '*' || expected === 'null') return false;
  return origin === expected;
};

/** Normalise a configured URL to a bare origin, or `null` if it isn't one. */
export const toOrigin = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
};

/**
 * Parse an inbound message. Returns `null` for anything that is not a
 * well-formed §4 canvas message — the runtime then ignores it silently.
 * Origin checking is the CALLER's job and happens first; this is shape only.
 */
export const parseCanvasMessage = (data: unknown): CanvasMessage | null => {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.source !== CANVAS_SOURCE) return null;

  if (raw.type === 'enable-edit') {
    return { source: CANVAS_SOURCE, type: 'enable-edit' };
  }

  const blockId = typeof raw.blockId === 'string' ? raw.blockId : null;
  const field = typeof raw.field === 'string' ? raw.field : null;
  if (!blockId || !field) return null;

  if (raw.type === 'commit-ok') {
    return { source: CANVAS_SOURCE, type: 'commit-ok', blockId, field };
  }
  if (raw.type === 'commit-failed') {
    return {
      source: CANVAS_SOURCE,
      type: 'commit-failed',
      blockId,
      field,
      message: typeof raw.message === 'string' ? raw.message : undefined,
    };
  }
  return null;
};

export const editorMessages = {
  ready: (): EditorMessage => ({ source: EDITOR_SOURCE, type: 'ready' }),
  selected: (blockId: string): EditorMessage => ({
    source: EDITOR_SOURCE,
    type: 'selected',
    blockId,
  }),
  dirty: (blockId: string, field: string): EditorMessage => ({
    source: EDITOR_SOURCE,
    type: 'dirty',
    blockId,
    field,
  }),
  edit: (blockId: string, field: string, value: string): EditorMessage => ({
    source: EDITOR_SOURCE,
    type: 'edit',
    blockId,
    field,
    value,
  }),
};
