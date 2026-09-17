import { z } from 'zod';

/**
 * Input for `buildDraftClipsSystemText` — the polling-on-send draft-clips
 * system block (W-C10-clip-tray Step 7).
 */
export const buildDraftClipsSystemTextSchema = z.object({
  organizationId: z.string().min(1),
});

export type BuildDraftClipsSystemTextInput = z.infer<
  typeof buildDraftClipsSystemTextSchema
>;

export interface BuildDraftClipsSystemTextOutput {
  /** Rendered system block text, or `null` when there is no active draft. */
  text: string | null;
}
