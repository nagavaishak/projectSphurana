import { apiClient } from '@borradh-workspace/api-client';
import type { Graphic } from '@borradh-workspace/api-client/types';
import { graphicSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface RegenerateGraphicInput {
  graphicId: string;
  /** The user's change request. */
  refinementInstruction?: string;
  /** `all` re-renders the whole graphic; `slide` refines just `slideIndex`. */
  scope?: 'all' | 'slide';
  /** Required when scope = 'slide'. 0-based. */
  slideIndex?: number;
  /**
   * TARGETED per-slide refine — a different instruction per named slide, in ONE
   * render. Supersedes `scope`/`slideIndex`, which say the same thing for
   * exactly one slide. Slides not named are carried across verbatim.
   */
  slideEdits?: {
    slideIndex: number;
    op: 'refine' | 'remove';
    note?: string;
  }[];
  /** What the renderer must hold FIXED. See `regeneration-intent.ts`. */
  regenerationIntent?: 'copy' | 'image' | 'branding' | 'full';
}

/**
 * Re-roll an existing graphic with a change request (create-post review modal).
 * POSTs `/graphics/:id/regenerate`; the API pins the original's template and
 * returns a fresh placeholder graphic the modal then polls.
 */
export const useRegenerateGraphic = (options?: {
  onSuccess?: (graphic: Graphic) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ graphicId, ...body }: RegenerateGraphicInput) =>
      apiClient.post<Graphic>(`graphics/${graphicId}/regenerate`, body, {
        schema: graphicSchema,
      }),
    onSuccess: (graphic) => {
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      options?.onSuccess?.(graphic);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to regenerate graphic');
      options?.onError?.(error);
    },
  });

  return {
    regenerateGraphic: mutation.mutate,
    regenerateGraphicAsync: mutation.mutateAsync,
    isRegenerating: mutation.isPending,
  };
};
