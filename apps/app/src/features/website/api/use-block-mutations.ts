'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { micrositeQueryKey } from './use-microsite';
import { revisionsQueryKey } from './use-revisions';

/**
 * The ONE client path that mutates a block.
 *
 * §5 is explicit: "drag-reorder in the canvas calls the same `move_block` the
 * agent calls. One code path, or the two drift and only one gets fixed." The
 * agent reaches `move_block` through the tool loop; the browser's only door is
 * §4's `PATCH microsites/:id/pages/:pageId/blocks/:blockId`, so BOTH the
 * inspector's prop edits and the canvas's drag-reorder go through this one
 * hook and that one endpoint.
 *
 * CONTRACT GAP (reported, not worked around): §4 gives the manual-edit endpoint
 * no body shape, and reorder is a position change rather than a prop change. We
 * send `{ propsPatch }` for an edit and `{ toIndex }` for a move on the same
 * request, mirroring the `update_block(propsPatch)` / `move_block(toIndex)`
 * tool signatures in §2 — the closest thing to the tools the HTTP surface
 * exposes. If the API lands a different body, this file is the only place that
 * changes.
 *
 * `propsPatch` is a PATCH, never a replace — §2 calls that "the single most
 * important shape in the tool set", because a full replace makes the writer
 * re-emit content it never intended to touch and silently drop fields. The
 * inspector therefore sends only the field the user actually changed.
 *
 * Every mutation here is also a revision (§5), so the history list and the
 * changes-since-publish count are invalidated alongside the document.
 */

export interface BlockPatchBody {
  /** Partial props — merged server-side. Never the whole props object. */
  propsPatch?: Record<string, unknown>;
  /** Layout variant change (BLOCK_VARIANTS). */
  variant?: string;
  /** Reorder within the page — the `move_block` shape. */
  toIndex?: number;
}

export interface BlockPatchVariables extends BlockPatchBody {
  pageId: string;
  blockId: string;
}

export function useBlockMutation(
  micrositeId: string | null,
  options?: { onSuccess?: (vars: BlockPatchVariables) => void }
) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ pageId, blockId, ...body }: BlockPatchVariables) =>
      apiClient.patch(
        `microsites/${micrositeId}/pages/${pageId}/blocks/${blockId}`,
        body
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: micrositeQueryKey });
      void queryClient.invalidateQueries({
        queryKey: revisionsQueryKey(micrositeId ?? 'none'),
      });
      options?.onSuccess?.(variables);
    },
    onError: (error: Error) => {
      // Loud on purpose. A manual edit that silently fails looks identical to
      // one that saved, and the user finds out when the site publishes wrong.
      toast.error(error.message || 'Could not save that change');
    },
  });

  return {
    /** Inspector: patch one or more props of a block. */
    updateBlock: (
      pageId: string,
      blockId: string,
      propsPatch: Record<string, unknown>
    ) => mutation.mutate({ pageId, blockId, propsPatch }),
    /**
     * Canvas inline text edit — the SAME endpoint and the SAME `propsPatch`
     * body as the inspector, awaited so the caller can tell the iframe whether
     * to keep or restore the text the user typed (inline-edit contract §5).
     * Not a second mutation path: `updateBlock` with its promise handed back.
     */
    updateBlockAsync: (
      pageId: string,
      blockId: string,
      propsPatch: Record<string, unknown>
    ) => mutation.mutateAsync({ pageId, blockId, propsPatch }),
    /** Inspector: change the layout variant. */
    updateVariant: (pageId: string, blockId: string, variant: string) =>
      mutation.mutate({ pageId, blockId, variant }),
    /** Canvas drag-reorder — the same endpoint, the `move_block` shape. */
    moveBlock: (pageId: string, blockId: string, toIndex: number) =>
      mutation.mutate({ pageId, blockId, toIndex }),
    isSaving: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
