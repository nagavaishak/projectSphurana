import { z } from 'zod';

export const synthesizeTtsSchema = z.object({
  organizationId: z.string().min(1),
  script: z.string().min(1),
  voice: z.string().min(1).default('alloy'),
  /** Frames-per-second of the target render, used to convert duration → frames. */
  fps: z.number().int().positive().default(30),
});

export type SynthesizeTtsInput = z.infer<typeof synthesizeTtsSchema>;

export interface SynthesizeTtsOutput {
  /** S3 key or fully-qualified URL the renderer can fetch. */
  url: string;
  /** Length of the generated audio in absolute frames at the requested fps. */
  durationFrames: number;
  /** Length in milliseconds, kept for downstream callers that work in ms. */
  durationMs: number;
  /** sha256(script + '\x00' + voice) — memoization key. */
  hash: string;
  /** True if this row came back from the cache (no provider call made). */
  cached: boolean;
}
