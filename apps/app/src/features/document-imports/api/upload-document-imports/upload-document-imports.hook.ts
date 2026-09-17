import { apiClient } from '@borradh-workspace/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { putFileWithProgress } from '@/features/patient-documents/api/put-with-progress';

import { documentImportKeys } from '../keys';
import {
  DOCUMENT_IMPORT_ACCEPT,
  DOCUMENT_IMPORT_MAX_SIZE_BYTES,
  type DocumentImportItem,
  type PresignDocumentImportResponse,
} from '../types';

export interface DocumentImportUploadState {
  /** Local id for React keys — not the server import id. */
  id: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'error';
  error?: string;
}

const ALLOWED_MIME_TYPES = Object.keys(DOCUMENT_IMPORT_ACCEPT);

/**
 * Say WHICH step died when the server won't say why.
 *
 * `SanitizeErrorsFilter` strips every 5xx body down to "An unexpected error
 * occurred" so internals never leak — correct, but it left the file row
 * showing seven words that fit a dead credential, a wedged bucket and a
 * genuine server bug equally well, and read to everyone as "the importer is
 * broken". Naming the step is safe (the client already knows which call it
 * made) and is the difference between "the upload never started" and "the
 * bytes are up, the server choked recording them" — which is exactly what
 * decides whether retrying can possibly help.
 *
 * 4xx messages are the feature's own, written for a person, so they pass
 * through untouched.
 */
const STEP_FAILURE = {
  start: {
    server: 'The upload never started — file storage isn’t answering.',
    offline: 'Couldn’t reach the server. Check your connection.',
  },
  finish: {
    server: 'Uploaded, but we couldn’t save it. Try again.',
    offline: 'Uploaded, but the connection dropped before we saved it.',
  },
} as const;

/** `ApiClientError` carries `status`; ky's `HTTPError` carries `response.status`. */
const statusOf = (error: unknown): number | undefined => {
  const e = error as { status?: number; response?: { status?: number } };
  return e?.status ?? e?.response?.status;
};

async function describeStepFailure<T>(
  step: keyof typeof STEP_FAILURE,
  request: Promise<T>
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const status = statusOf(error);
    // 4xx messages are the feature's own, written for a person — keep them.
    if (status !== undefined && status < 500) throw error;
    const reason = status === undefined ? 'offline' : 'server';
    throw new Error(STEP_FAILURE[step][reason], { cause: error });
  }
}

/**
 * Per-file pipeline for the bulk importer (ENG-784):
 * presign (creates the staging row) → PUT with progress → complete (queues
 * the matcher). Same shape as the vault's `useDocumentUploads`, with the
 * third step swapped from "record" to "complete" because the server already
 * knows the file — it only needs to hear the bytes landed.
 *
 * Sequential on purpose: one upload at a time keeps progress readable and
 * the matcher queue in arrival order.
 */
export const useUploadDocumentImports = () => {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<DocumentImportUploadState[]>([]);
  const nextId = useRef(0);

  const patch = useCallback(
    (id: string, changes: Partial<DocumentImportUploadState>) => {
      setUploads((current) =>
        current.map((u) => (u.id === id ? { ...u, ...changes } : u))
      );
    },
    []
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((current) => current.filter((u) => u.id !== id));
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<DocumentImportItem | null> => {
      const id = `import-${nextId.current++}-${Date.now()}`;
      let importId: string | null = null;
      setUploads((current) => [
        ...current,
        { id, fileName: file.name, progress: 0, status: 'uploading' },
      ]);

      try {
        if (file.size > DOCUMENT_IMPORT_MAX_SIZE_BYTES) {
          throw new Error('That file is over 15MB.');
        }
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
          throw new Error('Only PDFs and photos, sorry.');
        }

        const presigned = await describeStepFailure(
          'start',
          apiClient.post<PresignDocumentImportResponse>(
            'document-imports/presign',
            { fileName: file.name, mimeType: file.type, sizeBytes: file.size }
          )
        );
        importId = presigned.importId;

        await putFileWithProgress(presigned.url, file, (progress) =>
          patch(id, { progress: Math.min(progress, 99) })
        );

        const completed = await describeStepFailure(
          'finish',
          apiClient.post<DocumentImportItem>(
            `document-imports/${presigned.importId}/complete`
          )
        );

        dismissUpload(id);
        await queryClient.invalidateQueries({
          queryKey: documentImportKeys.all,
        });
        return completed;
      } catch (error) {
        patch(id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        });
        // The presign created a staging row; if the bytes never landed (or
        // `complete` failed) discard it so the list does not show a phantom
        // "Uploading" row forever. Best effort — the row is also discardable
        // by hand.
        if (importId) {
          await apiClient
            .delete(`document-imports/${importId}`)
            .then(() =>
              queryClient.invalidateQueries({
                queryKey: documentImportKeys.all,
              })
            )
            .catch(() => undefined);
        }
        return null;
      }
    },
    [patch, dismissUpload, queryClient]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        await uploadFile(file);
      }
    },
    [uploadFile]
  );

  return {
    uploads,
    uploadFile,
    uploadFiles,
    dismissUpload,
    isUploading: uploads.some((u) => u.status === 'uploading'),
  };
};
