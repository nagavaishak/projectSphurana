import { uploadFileToS3 } from '@/features/upload/api/resumable-upload';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  type DraftClip,
  type DraftClipSource,
  invalidateDraftClips,
} from '../use-draft-clips';

/**
 * Drop-a-clip-in-chat upload (W-C10-clip-tray).
 *
 * Three-leg flow that mirrors the existing `mass-video-upload-dialog` path:
 *  1. POST /upload/presigned-url → presigned S3 URL
 *  2. PUT the file to S3
 *  3. POST /assets to create the asset library row
 *  4. POST /assets/:id/analyze to queue tag generation (raw footage only)
 *  5. POST /videos/:id/draft-clips to insert the tray row pointing at the
 *     fresh assetId with `source: 'uploaded'`
 *
 * Returns the inserted tray row so the composer can drop the optimistic
 * placeholder it inserted on drag-drop. Tag analysis runs async in the
 * background; the next operator-send refetch picks up the populated tags.
 */

export const ASSISTANT_CLIP_UPLOAD_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

export type AssistantClipMimeType =
  (typeof ASSISTANT_CLIP_UPLOAD_MIME_TYPES)[number];

export const ASSISTANT_CLIP_UPLOAD_MAX_BYTES = 600 * 1024 * 1024; // 600 MB

const isAcceptedClipMime = (type: string): type is AssistantClipMimeType =>
  (ASSISTANT_CLIP_UPLOAD_MIME_TYPES as readonly string[]).includes(type);

export function validateAssistantClipUploadFile(file: File): string | null {
  if (!isAcceptedClipMime(file.type)) {
    return 'Only MP4, MOV, and WebM clips are supported.';
  }
  if (file.size > ASSISTANT_CLIP_UPLOAD_MAX_BYTES) {
    return 'Clip must be under 600 MB.';
  }
  return null;
}

interface CreateAssetResponse {
  id: string;
  name: string;
  blobUrl: string;
  type: string;
}

export interface UploadClipParams {
  file: File;
  videoId: string;
  beatOrder?: number;
  source?: DraftClipSource;
}

export interface UploadClipResult {
  asset: CreateAssetResponse;
  trayRow: DraftClip;
}

export function useUploadClip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      videoId,
      beatOrder,
      source = 'uploaded',
    }: UploadClipParams): Promise<UploadClipResult> => {
      const error = validateAssistantClipUploadFile(file);
      if (error) throw new Error(error);

      // 1-2. Upload to S3. Large clips use resumable multipart upload.
      const uploadResult = await uploadFileToS3(file, 'video', 'org-asset', {
        resumeNamespace: `assistant-clip:${videoId}`,
      });

      // 3. Create asset row. Tags start empty; analysis populates them async.
      const asset = await apiClient.post<CreateAssetResponse>('assets', {
        name: file.name.replace(/\.[^/.]+$/, ''),
        blobUrl: uploadResult.url,
        sourceFileName: file.name,
        type: 'video',
        source: 'raw',
        tags: [],
      });

      // 4. Queue analysis (best-effort — clip is usable in the tray either way).
      apiClient.post(`assets/${asset.id}/analyze`, {}).catch(() => {
        // Swallow — the tray row still lands and the operator can use the
        // clip immediately; tags would have been a nice-to-have for
        // autoSelectClips later.
      });

      // 5. Insert tray row. Sets processingStatus: 'processing' so the tile
      // shows a spinner until the next operator-send refetch flips it to
      // 'ready' (the asset analysis pipeline updates tags within ~5 min).
      const trayRow = await apiClient.post<DraftClip>(
        `videos/${videoId}/draft-clips`,
        {
          assetId: asset.id,
          source,
          beatOrder: beatOrder ?? 0,
          processingStatus: 'processing',
        }
      );

      return { asset, trayRow };
    },
    onSuccess: (_result, { videoId }) => {
      void invalidateDraftClips(queryClient, videoId);
    },
  });
}
