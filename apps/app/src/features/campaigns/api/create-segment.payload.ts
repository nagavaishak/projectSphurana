import { createSegmentRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { SegmentFilter } from './types';

/**
 * Audience-filter + segment-create payload builders for the messaging
 * campaigns feature.
 *
 * `buildSegmentFilter` is the ONE place a `SegmentFilter` is assembled from raw
 * form state (the segment-builder's checkboxes + tag input) — it used to live
 * inline as `buildFilter()` in `segment-builder.tsx`. `buildCreateSegmentPayload`
 * is the ONE place the `POST campaigns/segments` wire body is constructed, so
 * the composer's send flow and the standalone builder can never drift.
 */

/** Raw segment-builder form state (checkbox arrays + comma tag string). */
export interface SegmentFilterFormInput {
  status: string[];
  source: string[];
  tagsRaw: string;
  consentEmail: boolean;
  consentSms: boolean;
}

/** Assemble the persisted audience filter from raw form state. */
export function buildSegmentFilter(
  input: SegmentFilterFormInput
): SegmentFilter {
  const f: SegmentFilter = {};
  if (input.status.length) f.status = input.status;
  if (input.source.length) f.source = input.source;
  const tags = input.tagsRaw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length) f.tags = tags;
  if (input.consentEmail) f.consentEmail = true;
  if (input.consentSms) f.consentSms = true;
  return f;
}

/**
 * The exact `POST campaigns/segments` wire body — the CANONICAL request
 * contract (`packages/contracts/src/requests/campaigns.ts`), which the backend
 * feature schema also derives from. The nested filter shape lives there too.
 *
 * One behavioural note: the contract's `isDynamic` carries `.default(true)`, so
 * a parsed body now CONTAINS `isDynamic: true` even when the caller omitted it.
 * The value is exactly what the server would have applied.
 */
export const createSegmentBodySchema = createSegmentRequestSchema;

export type CreateSegmentBody = z.infer<typeof createSegmentBodySchema>;

/** Typed intent for creating a segment (no wire shape leaks to callers). */
export interface CreateSegmentIntent {
  name: string;
  filter: SegmentFilter;
  /** Omitted → server defaults to a dynamic segment. */
  isDynamic?: boolean;
}

/** THE builder for the create-segment wire body. */
export function buildCreateSegmentPayload(
  input: CreateSegmentIntent
): CreateSegmentBody {
  return createSegmentBodySchema.parse({
    name: input.name,
    filterJson: input.filter,
    ...(input.isDynamic !== undefined ? { isDynamic: input.isDynamic } : {}),
  });
}
