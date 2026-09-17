import { z } from 'zod';

/** Where the chosen visual came from — mirrors `provenance_media_source`. */
export const provenanceMediaSourceSchema = z.enum([
  'service-video-thumbnail',
  'service-image-asset',
  'owner-selected',
  'stock',
  'ai-generated',
  'none',
]);

/** Whether the org's real logo reached the image model. */
export const provenanceLogoOutcomeSchema = z.enum([
  'used',
  'missing-no-logo',
  'missing-fetch-failed',
  'not-applicable',
]);

export const rejectedCandidateSchema = z.object({
  assetId: z.string().min(1),
  /** Machine-readable, e.g. 'recently-used', 'no-thumbnail'. */
  reason: z.string().min(1),
  detail: z.string().optional(),
});

export const recordProvenanceSchema = z.object({
  organizationId: z.string().min(1),
  subjectType: z.enum(['graphic', 'video']),
  subjectId: z.string().min(1),

  batchId: z.string().min(1).optional(),
  batchItemId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),

  chosenAssetId: z.string().min(1).optional(),
  mediaSource: provenanceMediaSourceSchema,
  logoOutcome: provenanceLogoOutcomeSchema.default('not-applicable'),

  candidatesConsidered: z.array(z.string().min(1)).optional(),
  rejectedCandidates: z.array(rejectedCandidateSchema).optional(),

  templateSlug: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

/**
 * `z.input`, not `z.infer`: `logoOutcome` has a default, so the parsed OUTPUT
 * type marks it required while callers should be able to omit it. Video
 * callers have no logo decision to report at all.
 */
export type RecordProvenanceInput = z.input<typeof recordProvenanceSchema>;
export type ProvenanceMediaSource = z.infer<typeof provenanceMediaSourceSchema>;
export type ProvenanceLogoOutcome = z.infer<typeof provenanceLogoOutcomeSchema>;
