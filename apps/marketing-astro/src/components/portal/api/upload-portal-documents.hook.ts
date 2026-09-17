'use client';

import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type {
  PatientDocumentItem,
  PresignPatientDocumentResponse,
} from './types';

export interface DocumentUpload {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** 0–100 for the PUT itself; the presign/record hops are not counted. */
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * PUT the bytes straight at the presigned URL, reporting progress.
 *
 * XHR rather than fetch: fetch has no upload-progress event, and a 15MB scan
 * over clinic wifi with no progress bar reads as a hung page. The presigned
 * URL is a bucket origin, NOT our API — it carries no cookie and must not
 * (`withCredentials` stays false, the default).
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

/**
 * Upload documents to the patient's own vault.
 *
 * The generic `upload/presigned-url` endpoint is STAFF-guarded, so the portal
 * presigns and records through the patient-guarded `patient/documents` routes
 * via `patientFetch` — which carries the patient session cookie and nothing
 * else.
 */
export const useUploadPortalDocuments = () => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<DocumentUpload[]>([]);

  const patch = useCallback((id: string, next: Partial<DocumentUpload>) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...next } : upload
      )
    );
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setUploads((current) => [
          ...current,
          {
            id,
            fileName: file.name,
            sizeBytes: file.size,
            progress: 0,
            status: 'uploading',
          },
        ]);

        try {
          const presigned = await patientFetch<PresignPatientDocumentResponse>(
            `${PATIENT_PORTAL_PATHS.documents}/presign`,
            {
              method: 'POST',
              body: {
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
              },
              organizationSlug,
            }
          );

          await putWithProgress(presigned.url, file, (progress) =>
            patch(id, { progress })
          );

          await patientFetch<PatientDocumentItem>(
            PATIENT_PORTAL_PATHS.documents,
            {
              method: 'POST',
              body: {
                key: presigned.key,
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
              },
              organizationSlug,
            }
          );

          patch(id, { progress: 100, status: 'done' });
          queryClient.invalidateQueries({
            queryKey: patientPortalKeys.documents(organizationSlug),
          });
        } catch (error) {
          patch(id, {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Upload failed — please try again',
          });
        }
      }
    },
    [organizationSlug, patch, queryClient]
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id));
  }, []);

  return {
    uploads,
    uploadFiles,
    dismissUpload,
    isUploading: uploads.some((upload) => upload.status === 'uploading'),
  };
};
