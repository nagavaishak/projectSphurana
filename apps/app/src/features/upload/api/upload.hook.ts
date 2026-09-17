import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ResumableUploadError,
  type UploadProgressHandler,
  type UploadPurpose,
  type UploadResult,
  type UploadType,
  uploadFileToS3,
} from './resumable-upload';

export type {
  PresignedUrlResponse,
  UploadPurpose,
  UploadProgressDetail,
  UploadProgressHandler,
  UploadResult,
  UploadType,
} from './resumable-upload';

function showUploadErrorToast(
  message: string,
  file: File,
  retry: (file: File) => void
) {
  toast.error(message, {
    action:
      message.toLowerCase().includes('paused') ||
      message.toLowerCase().includes('resume')
        ? {
            label: 'Resume',
            onClick: () => retry(file),
          }
        : undefined,
  });
}

function logHandledUploadError(operation: string, error: Error) {
  console.warn(`[${operation}]`, error.message);
}

/**
 * Upload Image Hook
 * Uploads an image to S3 via presigned URL
 *
 * @param options.purpose - Upload purpose: 'profile' for profile pictures (public bucket), 'org-asset' for organization assets (private bucket)
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 * @param options.onProgress - Progress callback (0-100)
 */
export const useUploadImage = (options?: {
  purpose?: UploadPurpose;
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
  onProgress?: UploadProgressHandler;
  showToast?: boolean;
}) => {
  const purpose = options?.purpose ?? 'org-asset';
  const showToast = options?.showToast !== false;

  const retryUploadRef: { current?: (file: File) => void } = {};
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadFileToS3(file, 'image', purpose, {
        onProgress: options?.onProgress,
      });
    },
    onSuccess: (result) => {
      if (showToast) toast.success('Image uploaded successfully');
      options?.onSuccess?.(result);
    },
    onError: (error: Error, file) => {
      logHandledUploadError('upload.image', error);
      if (showToast) {
        showUploadErrorToast(
          error.message || 'Failed to upload image',
          file,
          (retryFile) => retryUploadRef.current?.(retryFile)
        );
      }
      options?.onError?.(error);
    },
  });
  retryUploadRef.current = mutation.mutate;

  return {
    ...mutation,
    upload: mutation.mutate,
    uploadAsync: mutation.mutateAsync,
    isUploading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

/**
 * Upload Profile Image Hook
 * Convenience hook for uploading profile pictures to the public bucket
 */
export const useUploadProfileImage = (options?: {
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
  onProgress?: UploadProgressHandler;
}) => {
  return useUploadImage({
    ...options,
    purpose: 'profile',
  });
};

/**
 * Upload Video Hook
 * Uploads a video to S3 via presigned URL
 *
 * @param options.purpose - Upload purpose: 'org-asset' for organization assets (private bucket)
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 * @param options.onProgress - Progress callback (0-100)
 */
export const useUploadVideo = (options?: {
  purpose?: UploadPurpose;
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
  onProgress?: UploadProgressHandler;
  showToast?: boolean;
}) => {
  const purpose = options?.purpose ?? 'org-asset';
  const showToast = options?.showToast !== false;

  const retryUploadRef: { current?: (file: File) => void } = {};
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadFileToS3(file, 'video', purpose, {
        onProgress: options?.onProgress,
      });
    },
    onSuccess: (result) => {
      if (showToast) toast.success('Video uploaded successfully');
      options?.onSuccess?.(result);
    },
    onError: (error: Error, file) => {
      logHandledUploadError('upload.video', error);
      if (showToast) {
        showUploadErrorToast(
          error.message || 'Failed to upload video',
          file,
          (retryFile) => retryUploadRef.current?.(retryFile)
        );
      }
      options?.onError?.(error);
    },
  });
  retryUploadRef.current = mutation.mutate;

  return {
    ...mutation,
    upload: mutation.mutate,
    uploadAsync: mutation.mutateAsync,
    isUploading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

/**
 * Detect upload type from file MIME type
 */
function getUploadTypeFromFile(file: File): UploadType {
  return file.type.startsWith('image/') ? 'image' : 'video';
}

/**
 * Upload File Hook
 * Uploads any supported file (image or video) to S3, auto-detecting the type.
 *
 * @param options.purpose - Upload purpose: 'org-asset' for organization assets (private bucket)
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 * @param options.onProgress - Progress callback (0-100)
 */
export const useUploadFile = (options?: {
  purpose?: UploadPurpose;
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
  onProgress?: UploadProgressHandler;
  showToast?: boolean;
}) => {
  const purpose = options?.purpose ?? 'org-asset';
  const showToast = options?.showToast !== false;

  const retryUploadRef: { current?: (file: File) => void } = {};
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const type = getUploadTypeFromFile(file);
      return uploadFileToS3(file, type, purpose, {
        onProgress: options?.onProgress,
      });
    },
    onSuccess: (result) => {
      if (showToast) toast.success('File uploaded successfully');
      options?.onSuccess?.(result);
    },
    onError: (error: Error, file) => {
      logHandledUploadError('upload.file', error);
      if (showToast) {
        showUploadErrorToast(
          error instanceof ResumableUploadError
            ? error.message
            : error.message || 'Failed to upload file',
          file,
          (retryFile) => retryUploadRef.current?.(retryFile)
        );
      }
      options?.onError?.(error);
    },
  });
  retryUploadRef.current = mutation.mutate;

  return {
    ...mutation,
    upload: mutation.mutate,
    uploadAsync: mutation.mutateAsync,
    isUploading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
