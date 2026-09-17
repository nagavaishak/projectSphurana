import { useCallback, useRef, useState } from 'react';

import { putFileWithProgress } from './put-with-progress';
import {
  PATIENT_DOCUMENT_ACCEPT,
  PATIENT_DOCUMENT_MAX_SIZE_BYTES,
  type PatientDocumentItem,
  type PresignPatientDocumentResponse,
} from './types';

export interface DocumentUploadState {
  /** Local id for React keys — not the server document id. */
  id: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'error';
  error?: string;
}

export interface DocumentUploadTransport {
  presign: (body: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<PresignPatientDocumentResponse>;
  record: (body: {
    key: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<PatientDocumentItem>;
}

const ALLOWED_MIME_TYPES = Object.keys(PATIENT_DOCUMENT_ACCEPT);

/**
 * Shared per-file upload pipeline for the document vault (ENG-647 Phase 4):
 * presign → PUT with progress → record → onRecorded (refetch). The portal
 * and the staff panel differ only in transport (patientFetch vs apiClient),
 * injected via `transport`.
 */
export function useDocumentUploads(
  transport: DocumentUploadTransport,
  options?: { onRecorded?: (item: PatientDocumentItem) => void }
) {
  const [uploads, setUploads] = useState<DocumentUploadState[]>([]);
  const nextId = useRef(0);

  const patch = useCallback(
    (id: string, changes: Partial<DocumentUploadState>) => {
      setUploads((current) =>
        current.map((u) => (u.id === id ? { ...u, ...changes } : u))
      );
    },
    []
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((current) => current.filter((u) => u.id !== id));
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const id = `upload-${nextId.current++}-${Date.now()}`;
      setUploads((current) => [
        ...current,
        { id, fileName: file.name, progress: 0, status: 'uploading' },
      ]);

      try {
        // Client-side pre-checks mirror the server's rules so the common
        // failures surface instantly (the API re-validates everything).
        if (file.size > PATIENT_DOCUMENT_MAX_SIZE_BYTES) {
          throw new Error('File is too large (max 15MB)');
        }
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
          throw new Error(
            'Only PDF, JPEG, PNG, HEIC and WebP files are allowed'
          );
        }

        const presigned = await transport.presign({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });

        await putFileWithProgress(presigned.url, file, (progress) =>
          // Hold 100% back for the record step.
          patch(id, { progress: Math.min(progress, 99) })
        );

        const recorded = await transport.record({
          key: presigned.key,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });

        removeUpload(id);
        options?.onRecorded?.(recorded);
        return recorded;
      } catch (error) {
        patch(id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
        return null;
      }
    },
    [transport, patch, removeUpload, options]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      // Sequential keeps mobile connections honest and progress readable.
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
    dismissUpload: removeUpload,
    isUploading: uploads.some((u) => u.status === 'uploading'),
  };
}
