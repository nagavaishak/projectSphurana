/**
 * INLINE EDIT — the DOM half.
 *
 * Loaded ONLY by `EditMode.astro`, which is imported only by the token-gated
 * draft preview route. A published page never imports this module, so no bundle
 * of it is ever emitted for `/sites/{slug}/…` — see the note in EditMode.astro.
 *
 * All decisions (what is editable, what a value may contain, which messages to
 * believe) live in `./editable.ts` and are unit tested there. This file is the
 * wiring: listeners, focus bookkeeping, and the error banner.
 */

import {
  type EditorMessage,
  editorMessages,
  hasChanged,
  isMultilineField,
  isTrustedOrigin,
  parseCanvasMessage,
  sanitizeEditableText,
} from './editable';

export interface EditRuntimeOptions {
  /** The ONE origin allowed to talk to this frame, and the only target we post to. */
  parentOrigin: string;
  doc?: Document;
  /** The frame we answer. Defaults to `window.parent`. */
  peer?: Window | null;
}

interface FieldState {
  /** The value the node started with — what Escape and a failed commit restore. */
  baseline: string;
  /** Sent once per focus session, on the first keystroke. */
  dirtySent: boolean;
  /** Value posted to the parent and not yet acknowledged. */
  pending: string | null;
}

const EDITABLE_SELECTOR = '[data-ms-editable][data-ms-block][data-ms-field]';

const keyOf = (blockId: string, field: string) => `${blockId}::${field}`;

export function startMicrositeEditMode(options: EditRuntimeOptions): {
  stop: () => void;
} {
  const doc = options.doc ?? document;
  const view = doc.defaultView;
  const peer = options.peer ?? view?.parent ?? null;
  const parentOrigin = options.parentOrigin;

  const state = new Map<string, FieldState>();

  const post = (message: EditorMessage) => {
    // NEVER '*'. An explicit target origin is the only thing stopping this
    // payload being delivered to whatever page happens to frame us.
    if (!peer || !parentOrigin) return;
    peer.postMessage(message, parentOrigin);
  };

  const fieldOf = (el: Element) => ({
    blockId: el.getAttribute('data-ms-block') ?? '',
    field: el.getAttribute('data-ms-field') ?? '',
  });

  const stateFor = (el: HTMLElement): FieldState => {
    const { blockId, field } = fieldOf(el);
    const key = keyOf(blockId, field);
    let entry = state.get(key);
    if (!entry) {
      entry = {
        baseline: sanitizeEditableText(el.textContent, {
          multiline: isMultilineField(field),
        }),
        dirtySent: false,
        pending: null,
      };
      state.set(key, entry);
    }
    return entry;
  };

  /**
   * Read the node as TEXT and normalise the node itself back to that text.
   *
   * `contenteditable` accepts pasted markup even under `plaintext-only` in
   * browsers that ignore the hint, so this both (a) commits `textContent`,
   * never `innerHTML`, and (b) removes whatever elements the paste created so
   * what is on screen matches what was saved.
   */
  const readAndFlatten = (el: HTMLElement, field: string): string => {
    const multiline = isMultilineField(field);
    const value = sanitizeEditableText(el.textContent, { multiline });
    if (el.children.length > 0) el.textContent = value;
    return value;
  };

  const banner = () => {
    let node = doc.getElementById('ms-edit-error');
    if (!node) {
      node = doc.createElement('div');
      node.id = 'ms-edit-error';
      node.setAttribute('role', 'alert');
      node.hidden = true;
      doc.body.appendChild(node);
    }
    return node;
  };

  const showError = (message: string) => {
    const node = banner();
    node.textContent = message;
    node.hidden = false;
  };

  const clearError = () => {
    const node = doc.getElementById('ms-edit-error');
    if (node) node.hidden = true;
  };

  /* ---------------------------------------------------------------- */
  /* Outbound                                                          */
  /* ---------------------------------------------------------------- */

  const commit = (el: HTMLElement) => {
    const { blockId, field } = fieldOf(el);
    if (!blockId || !field) return;
    const entry = stateFor(el);
    const multiline = isMultilineField(field);
    const value = readAndFlatten(el, field);

    // No commit when the value is unchanged: a focus/blur with no typing must
    // not create a revision.
    if (!hasChanged(entry.baseline, value, { multiline })) {
      el.textContent = entry.baseline;
      entry.dirtySent = false;
      return;
    }

    entry.pending = value;
    entry.dirtySent = false;
    el.setAttribute('data-ms-pending', '');
    post(editorMessages.edit(blockId, field, value));
  };

  const onFocusIn = (event: Event) => {
    const el = (event.target as HTMLElement | null)?.closest?.(
      EDITABLE_SELECTOR
    ) as HTMLElement | null;
    if (!el) return;
    const entry = stateFor(el);
    entry.dirtySent = false;
    const { blockId } = fieldOf(el);
    if (blockId) post(editorMessages.selected(blockId));
  };

  const onFocusOut = (event: Event) => {
    const el = (event.target as HTMLElement | null)?.closest?.(
      EDITABLE_SELECTOR
    ) as HTMLElement | null;
    if (!el) return;
    // Commit on blur as well as on Enter: a user who types and immediately
    // clicks Publish must not lose the edit.
    commit(el);
  };

  const onInput = (event: Event) => {
    const el = (event.target as HTMLElement | null)?.closest?.(
      EDITABLE_SELECTOR
    ) as HTMLElement | null;
    if (!el) return;
    const entry = stateFor(el);
    if (entry.dirtySent) return;
    entry.dirtySent = true;
    const { blockId, field } = fieldOf(el);
    if (blockId && field) post(editorMessages.dirty(blockId, field));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const el = (event.target as HTMLElement | null)?.closest?.(
      EDITABLE_SELECTOR
    ) as HTMLElement | null;
    if (!el) return;
    const { field } = fieldOf(el);

    if (event.key === 'Escape') {
      // Revert to the value the node started with and emit NOTHING.
      const entry = stateFor(el);
      el.textContent = entry.baseline;
      entry.dirtySent = false;
      event.preventDefault();
      el.blur();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !isMultilineField(field)) {
      event.preventDefault();
      commit(el);
      el.blur();
    }
  };

  /** Paste as text. Belt and braces next to the sanitiser on commit. */
  const onPaste = (event: ClipboardEvent) => {
    const el = (event.target as HTMLElement | null)?.closest?.(
      EDITABLE_SELECTOR
    ) as HTMLElement | null;
    if (!el) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    doc.execCommand?.('insertText', false, text);
  };

  /**
   * Links are navigation in the published page and an editing surface here
   * (`ctaLabel`, `buttonLabel` live inside anchors). In edit mode the canvas
   * must not navigate away from the draft, so every in-frame link click is
   * swallowed; block selection still reports up.
   */
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return;
    const anchor = target.closest('a[href]');
    if (anchor) event.preventDefault();
    const block = target.closest('[data-ms-block]');
    const blockId = block?.getAttribute('data-ms-block');
    if (blockId && !target.closest(EDITABLE_SELECTOR)) {
      post(editorMessages.selected(blockId));
    }
  };

  /* ---------------------------------------------------------------- */
  /* Inbound                                                           */
  /* ---------------------------------------------------------------- */

  /*
   * Found by walking, not by building a selector out of an id that came from
   * jsonb — an id containing a quote would otherwise change the meaning of the
   * selector, and `CSS.escape` is not present in every environment this runs in.
   */
  const nodeFor = (blockId: string, field: string): HTMLElement | null => {
    for (const el of Array.from(
      doc.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)
    )) {
      const found = fieldOf(el);
      if (found.blockId === blockId && found.field === field) return el;
    }
    return null;
  };

  const onMessage = (event: MessageEvent) => {
    // Origin first, shape second. Anything else is ignored in silence.
    if (!isTrustedOrigin(event.origin, parentOrigin)) return;
    const message = parseCanvasMessage(event.data);
    if (!message) return;

    if (message.type === 'enable-edit') {
      post(editorMessages.ready());
      return;
    }

    const entry = state.get(keyOf(message.blockId, message.field));
    const el = nodeFor(message.blockId, message.field);
    el?.removeAttribute('data-ms-pending');

    if (message.type === 'commit-ok') {
      if (entry?.pending !== null && entry?.pending !== undefined) {
        entry.baseline = entry.pending;
        entry.pending = null;
      }
      clearError();
      return;
    }

    // commit-failed: the text on screen was never saved. Put the previous
    // value back and say so — text that stays but did not ship is the worst
    // outcome here, because the user believes it did.
    if (el && entry) {
      el.textContent = entry.baseline;
      entry.pending = null;
    }
    el?.setAttribute('data-ms-failed', '');
    showError(
      message.message?.trim() || 'That change could not be saved. Try again.'
    );
    if (el) {
      view?.setTimeout(() => el.removeAttribute('data-ms-failed'), 2_000);
    }
  };

  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('paste', onPaste, true);
  doc.addEventListener('click', onClick, true);
  view?.addEventListener('message', onMessage);

  // Seed the baselines before the user can touch anything, so a first edit
  // always has something to revert to.
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)
  )) {
    stateFor(el);
  }

  post(editorMessages.ready());

  return {
    stop: () => {
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('paste', onPaste, true);
      doc.removeEventListener('click', onClick, true);
      view?.removeEventListener('message', onMessage);
    },
  };
}
