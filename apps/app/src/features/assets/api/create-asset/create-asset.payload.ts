import { createAssetRequestSchema } from '@borradh-workspace/contracts';
import type { AssetSource } from '@borradh-workspace/labels';
import type { z } from 'zod';
import type { CreateAssetInput } from '../types';

/**
 * Create-asset payload builder — the ONE place the `POST /assets` wire body is
 * assembled. Every upload surface (content library, content-studio, videos,
 * graphics/before-after, onboarding, ad/social pickers) routes through this via
 * `useCreateAsset`, passing typed {@link CreateAssetIntent} — never a pre-built
 * body. If no surface builds the body, no two surfaces can build it differently.
 */

/** Strip a single trailing file extension (`clip.final.mp4` → `clip.final`). */
function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

/** Media type from a File's MIME type: images → `image`, everything else → `video`. */
function mediaTypeForFile(file: File): 'video' | 'image' {
  return file.type.startsWith('image/') ? 'image' : 'video';
}

/**
 * The intent an upload surface has after it finishes uploading a File. This is
 * NOT the wire body — {@link buildCreateAssetPayload} maps it to the canonical
 * body. Surfaces supply only what they naturally know (the File, the blob URL,
 * their tags/source/batch context).
 */
export interface CreateAssetIntent {
  /** The uploaded File — source of `name`, `sourceFileName`, media type, `capturedAt`. */
  file: File;
  /** The storage URL returned by the upload step. */
  blobUrl: string;
  /** Content-library tags. Defaults to `[]`. */
  tags?: string[];
  /** Raw vs edited footage — governs whether AI analysis runs. Defaults to `'raw'`. */
  source?: AssetSource;
  /** Upload-batch id, when a surface groups uploads into a batch. */
  batchId?: string;
  /**
   * Explicit media-type override. Video-only pickers pass `'video'`; omit to
   * derive from the File's MIME type.
   */
  type?: 'video' | 'image';
  /**
   * Persist the File's last-modified time as `capturedAt` (onboarding uses this
   * for chronological ordering of the intake gallery).
   */
  captureFromFile?: boolean;
}

/**
 * The strict wire body for `POST /assets`. Mirrors the backend
 * `createAssetInputSchema` minus the server-injected `organizationId` /
 * `uploadedById`. `.strict()` makes an extra or misspelled field a parse error
 * rather than a silent strip.
 */
export const createAssetBodySchema = createAssetRequestSchema;

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;

/**
 * THE create-asset payload builder. Turns a surface's {@link CreateAssetIntent}
 * into the one canonical wire body:
 * - `name` is the filename with its extension stripped (every surface, always);
 * - `sourceFileName` is the raw filename;
 * - `type` is the explicit override or, absent that, derived from the MIME type;
 * - `tags` default `[]`, `source` defaults `'raw'`, `placeholderTypes` is `[]`;
 * - `capturedAt` is set from the File's last-modified time only when requested.
 */
export function buildCreateAssetPayload(
  intent: CreateAssetIntent
): CreateAssetInput {
  const capturedAt =
    intent.captureFromFile && intent.file.lastModified
      ? new Date(intent.file.lastModified).toISOString()
      : undefined;

  return createAssetBodySchema.parse({
    name: stripExtension(intent.file.name),
    blobUrl: intent.blobUrl,
    sourceFileName: intent.file.name,
    tags: intent.tags ?? [],
    type: intent.type ?? mediaTypeForFile(intent.file),
    source: intent.source ?? 'raw',
    placeholderTypes: [],
    capturedAt,
    batchId: intent.batchId,
  }) as CreateAssetInput;
}
