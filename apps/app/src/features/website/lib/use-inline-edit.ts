import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * The canvas half of the inline-editing conversation
 * (`docs/plans/microsites-inline-edit-contract.md` §4).
 *
 * The renderer marks text up as `contenteditable` and reports what the user
 * typed; this hook hosts that conversation and turns an `edit` message into the
 * SAME block mutation the inspector and the agent perform. It deliberately owns
 * no mutation of its own (§1: "the commit path is the same endpoint the agent
 * and the inspector use") — the caller passes `commit`, which is
 * `useBlockMutation`.
 *
 * SECURITY. Every inbound message is checked against the preview origin, and
 * every outbound message names that origin explicitly — never `'*'`. An iframe
 * host that trusts unvalidated `postMessage` lets any page that can get a
 * handle on this window drive block writes into a tenant's website, which is
 * exactly the vulnerability §4 calls out. Two consequences fall out of that:
 *
 * - If we cannot derive an origin from `previewUrl` (absent, or not an absolute
 *   URL) we attach NO listener at all. Refusing to listen is the safe failure;
 *   listening with a permissive check is not.
 * - Where the iframe element is available we also require `event.source` to be
 *   its `contentWindow`, so a same-origin popup or a second frame served from
 *   the preview host cannot speak for the preview.
 */

export const EDITOR_MESSAGE_SOURCE = 'microsite-editor';
export const CANVAS_MESSAGE_SOURCE = 'microsite-canvas';

/** Iframe → parent (§4). */
export type InlineEditInboundMessage =
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: 'ready' }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: 'selected'; blockId: string }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: 'edit';
      blockId: string;
      field: string;
      value: string;
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: 'dirty';
      blockId: string;
      field: string;
    };

/** Parent → iframe (§4). */
export type InlineEditOutboundMessage =
  | { source: typeof CANVAS_MESSAGE_SOURCE; type: 'enable-edit' }
  | {
      source: typeof CANVAS_MESSAGE_SOURCE;
      type: 'commit-ok';
      blockId: string;
      field: string;
    }
  | {
      source: typeof CANVAS_MESSAGE_SOURCE;
      type: 'commit-failed';
      blockId: string;
      field: string;
      message: string;
    };

export interface InlineEditCommit {
  blockId: string;
  field: string;
  value: string;
}

export interface UseInlineEditOptions {
  /** The preview iframe. Used for the origin check and as the post target. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Absolute draft-preview URL; its origin is the only peer we trust. */
  previewUrl: string | null | undefined;
  /** A block was clicked in the preview — scope the next prompt to it. */
  onSelectBlock: (blockId: string) => void;
  /**
   * Current stored value of a field, for the §5 "no commit when unchanged"
   * rule. Return `undefined` when the block or field is unknown to the canvas,
   * in which case we let the commit through rather than dropping a real edit.
   */
  getFieldValue: (blockId: string, field: string) => string | undefined;
  /** Perform the mutation. Must reject when the save failed. */
  commit: (input: InlineEditCommit) => Promise<unknown>;
  /** The user started typing in a field. */
  onDirty?: (blockId: string, field: string) => void;
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function useInlineEdit({
  iframeRef,
  previewUrl,
  onSelectBlock,
  getFieldValue,
  commit,
  onDirty,
}: UseInlineEditOptions) {
  const previewOrigin = useMemo(() => originOf(previewUrl), [previewUrl]);

  // The listener is attached once per origin; callbacks change on every render
  // of the editor, and re-subscribing on each of those would drop messages that
  // arrive mid-swap. So the handler reads the latest callbacks from a ref.
  const callbacks = useRef({ onSelectBlock, getFieldValue, commit, onDirty });
  callbacks.current = { onSelectBlock, getFieldValue, commit, onDirty };

  const post = useCallback(
    (message: InlineEditOutboundMessage) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || !previewOrigin) return;
      target.postMessage(message, previewOrigin);
    },
    [iframeRef, previewOrigin]
  );

  useEffect(() => {
    // No trusted peer, no listener. See the security note above.
    if (!previewOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== previewOrigin) return;

      const frameWindow = iframeRef.current?.contentWindow;
      if (frameWindow && event.source !== frameWindow) return;

      const data = event.data as Partial<InlineEditInboundMessage> | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== EDITOR_MESSAGE_SOURCE) return;

      switch (data.type) {
        case 'ready':
          post({ source: CANVAS_MESSAGE_SOURCE, type: 'enable-edit' });
          return;

        case 'selected': {
          const { blockId } = data;
          if (typeof blockId !== 'string' || !blockId) return;
          callbacks.current.onSelectBlock(blockId);
          return;
        }

        case 'dirty': {
          const { blockId, field } = data;
          if (typeof blockId !== 'string' || typeof field !== 'string') return;
          callbacks.current.onDirty?.(blockId, field);
          return;
        }

        case 'edit': {
          const { blockId, field, value } = data;
          if (
            typeof blockId !== 'string' ||
            typeof field !== 'string' ||
            typeof value !== 'string'
          ) {
            return;
          }

          // §5: a focus/blur with no typing must not create a revision, or the
          // history fills with noise and "N changes since last publish" stops
          // meaning anything. The iframe reports commit-ok either way, so it
          // can clear its dirty state.
          const current = callbacks.current.getFieldValue(blockId, field);
          if (current !== undefined && current === value) {
            post({
              source: CANVAS_MESSAGE_SOURCE,
              type: 'commit-ok',
              blockId,
              field,
            });
            return;
          }

          void callbacks.current
            .commit({ blockId, field, value })
            .then(() => {
              post({
                source: CANVAS_MESSAGE_SOURCE,
                type: 'commit-ok',
                blockId,
                field,
              });
            })
            .catch((error: unknown) => {
              // §5: the iframe restores the previous text on this message.
              // Leaving the new text on screen after a failed save is the worst
              // outcome here — the user believes it shipped.
              post({
                source: CANVAS_MESSAGE_SOURCE,
                type: 'commit-failed',
                blockId,
                field,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Could not save that change',
              });
            });
          return;
        }

        default:
          return;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [previewOrigin, iframeRef, post]);

  return { previewOrigin, postToPreview: post };
}
