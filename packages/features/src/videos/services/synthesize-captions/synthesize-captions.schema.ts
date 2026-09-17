import { z } from 'zod';

export const synthesizeCaptionsSchema = z.object({
  organizationId: z.string().min(1),
  /** URL or S3 key for the audio to transcribe. The service handles both. */
  audioUrl: z.string().min(1),
  /** FPS the renderer will use — caption page bounds are emitted in frames. */
  fps: z.number().int().positive().default(30),
  /**
   * Maximum characters per caption page. Retained for back-compat; the v1-style
   * packer breaks on word count / duration / punctuation instead.
   */
  maxCharsPerPage: z.number().int().positive().default(80),
  /** Max words per TikTok caption page (v1 default: 5). */
  maxWordsPerPage: z.number().int().positive().default(5),
  /** Max page duration in ms before forcing a break (v1 default: 1200). */
  maxPageDurationMs: z.number().int().positive().default(1200),
  /** Minimum gap (frames) appended after a page's last word (v1 default: 2). */
  minGapFrames: z.number().int().nonnegative().default(2),
  /**
   * Clean caption text to display, aligned onto Whisper word timing. When set,
   * the page text/words use this instead of the raw transcription — matching
   * v1, so brand names aren't shown mis-transcribed. For AI voiceover the
   * caller passes the script text here.
   */
  editedText: z.string().optional(),
});

/** `z.input`, not `z.infer` — see build-brand-corpus.schema.ts. Every tuning
 *  knob here defaults, and callers set only the ones they mean to override. */
export type SynthesizeCaptionsInput = z.input<typeof synthesizeCaptionsSchema>;

/** Per-word timing in milliseconds (doc-relative). Drives word-by-word highlight. */
export interface SynthesizedCaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Caption page emitted to the RenderDoc. Page bounds (`fromFrame`/`toFrame`) are
 * absolute frames at the requested fps; `words` carry per-word ms timing for the
 * TikTok highlight.
 */
export interface SynthesizedCaptionPage {
  fromFrame: number;
  toFrame: number;
  text: string;
  words: SynthesizedCaptionWord[];
}

export interface SynthesizeCaptionsOutput {
  pages: SynthesizedCaptionPage[];
  /** sha256(audioUrl + editedText) — memoization key. */
  hash: string;
  cached: boolean;
}
