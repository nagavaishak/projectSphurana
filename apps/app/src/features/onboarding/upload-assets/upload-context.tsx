import {
  useCreateAsset,
  useCreateUploadBatch,
  useReanalyzeAsset,
} from '@/features/assets';
import { useAnalysisTrackerStore } from '@/features/assets/background-analysis';
import { useUploadFile } from '@/features/upload';
import { logError, logWarning } from '@/lib/log-error';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

const MAX_CONCURRENT_UPLOADS = 2;

export interface UploadedAsset {
  id: string;
  file: File;
  objectUrl: string;
  status: 'uploading' | 'processing' | 'analyzing' | 'complete' | 'error';
  progress: number;
  assetId?: string;
  tags: string[];
  error?: string;
}

interface UploadContextValue {
  batchId: string | null;
  uploadedAssets: UploadedAsset[];
  addFiles: (files: File[]) => void;
  removeAsset: (id: string) => void;
  /** Every file has finished uploading (analysis runs in the background). */
  isAllUploadsComplete: boolean;
  hasActiveUploads: boolean;
  completedCount: number;
  processingCount: number;
  totalCount: number;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploadContext() {
  const ctx = useContext(UploadContext);
  if (!ctx)
    throw new Error('useUploadContext must be used within UploadProvider');
  return ctx;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  const batchIdRef = useRef<string | null>(null);
  const hasShownCompletionToast = useRef(false);

  const trackAnalysis = useAnalysisTrackerStore((state) => state.track);
  const untrackAnalysis = useAnalysisTrackerStore((state) => state.untrack);
  const trackedAnalyses = useAnalysisTrackerStore((state) => state.tracked);

  const { createAssetAsync } = useCreateAsset({ showToast: false });
  const { createBatchAsync } = useCreateUploadBatch();
  const { reanalyzeAssetAsync } = useReanalyzeAsset({ showToast: false });
  const { uploadAsync: uploadFileAsync } = useUploadFile({
    purpose: 'org-asset',
    showToast: false,
  });

  const updateAsset = useCallback(
    (id: string, updates: Partial<Omit<UploadedAsset, 'id' | 'file'>>) => {
      setUploadedAssets((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      );
    },
    []
  );

  const hasActiveUploads = uploadedAssets.some(
    (a) =>
      a.status === 'uploading' ||
      a.status === 'processing' ||
      a.status === 'analyzing'
  );

  /**
   * Every file has finished UPLOADING — which is all the funnel needs to move
   * on. Analysis deliberately does not appear here: it now runs in the
   * background, so gating the funnel on it would trap the user for as long as
   * the worker queue is deep (production has seen 84 minutes).
   */
  const isAllUploadsComplete =
    uploadedAssets.length > 0 &&
    uploadedAssets.every(
      (a) => a.status !== 'uploading' && a.status !== 'processing'
    );

  const completedCount = uploadedAssets.filter(
    (a) => a.status === 'complete'
  ).length;
  const processingCount = uploadedAssets.filter(
    (a) =>
      a.status === 'uploading' ||
      a.status === 'processing' ||
      a.status === 'analyzing'
  ).length;

  // Cleanup object URLs on unmount. There are no polling timers left to clear:
  // analysis is watched by `BackgroundAnalysisProvider`, which deliberately
  // OUTLIVES this provider so tagging survives leaving the funnel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only run cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    const assets = uploadedAssets;
    return () => {
      mountedRef.current = false;
      for (const a of assets) {
        URL.revokeObjectURL(a.objectUrl);
      }
    };
  }, []);

  // Hand analysis off to the app-wide tracker.
  //
  // Analysis is a SERVER-owned lifecycle: the worker persists the status and
  // writes the resulting tags onto the asset row, so nothing depends on this
  // screen staying mounted. Registering the asset here means the user can
  // continue through the funnel, navigate away, or close the tab while tagging
  // finishes — and `BackgroundAnalysisProvider` reports the outcome wherever
  // they end up.
  useEffect(() => {
    const toTrack = uploadedAssets
      .filter((a) => a.status === 'analyzing' && a.assetId)
      .map((a) => ({ assetId: a.assetId as string, label: a.file.name }));

    if (toTrack.length > 0) trackAnalysis(toTrack);
  }, [uploadedAssets, trackAnalysis]);

  // Mirror tracker outcomes into local state, so a user who DID stay on this
  // screen still watches tags arrive.
  useEffect(() => {
    for (const a of uploadedAssets) {
      if (a.status !== 'analyzing' || !a.assetId) continue;

      const entry = trackedAnalyses[a.assetId];
      if (!entry || entry.status === 'pending') continue;

      if (entry.status === 'completed') {
        updateAsset(a.id, { status: 'complete', tags: entry.tags });
      } else if (entry.status === 'failed') {
        // The worker already reported the real cause to Sentry once; warn here
        // to avoid duplicate noise.
        logWarning('upload.analysisFailed', 'Asset analysis failed', {
          feature: 'upload',
          extra: { assetId: a.assetId, uploadId: a.id },
        });
        updateAsset(a.id, { status: 'error', error: 'Analysis failed' });
      } else {
        // Abandoned: the asset is fine and usable, only the tagging is
        // unresolved. Not an error for the user.
        updateAsset(a.id, {
          status: 'complete',
          tags: [],
          error: 'Tagging is taking longer than expected',
        });
      }
    }
  }, [trackedAnalyses, uploadedAssets, updateAsset]);

  // Show completion toast
  useEffect(() => {
    if (hasActiveUploads) {
      hasShownCompletionToast.current = false;
    }
  }, [hasActiveUploads]);

  // Upload-completion toast. Tagging gets its own toast from
  // `BackgroundAnalysisProvider` whenever it lands, which may be long after
  // the user has left this screen.
  useEffect(() => {
    if (isAllUploadsComplete && !hasShownCompletionToast.current) {
      hasShownCompletionToast.current = true;
      const successCount = completedCount;
      const errorCount = uploadedAssets.filter(
        (a) => a.status === 'error'
      ).length;

      // Invalidate batch asset queries so conditional steps (before/after, talking head) rebuild
      if (batchIdRef.current) {
        queryClient.invalidateQueries({
          queryKey: ['assets', 'batch', batchIdRef.current],
        });
      }

      if (errorCount === 0) {
        toast.success(
          `All ${successCount} ${successCount === 1 ? 'asset' : 'assets'} uploaded`
        );
      } else {
        toast.success(
          `${successCount} of ${uploadedAssets.length} assets uploaded`
        );
      }
    }
  }, [isAllUploadsComplete, completedCount, uploadedAssets, queryClient]);

  const processFile = useCallback(
    async (file: File) => {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(file);
      const isImage = file.type.startsWith('image/');

      setUploadedAssets((prev) => [
        ...prev,
        {
          id: uploadId,
          file,
          objectUrl,
          status: 'uploading',
          progress: 0,
          tags: [],
        },
      ]);

      try {
        const uploadResult = await uploadFileAsync(file);
        updateAsset(uploadId, { progress: 50, status: 'processing' });

        const createdAsset = await createAssetAsync({
          file,
          blobUrl: uploadResult.url,
          type: isImage ? 'image' : 'video',
          captureFromFile: true,
          batchId: batchIdRef.current ?? undefined,
        });
        updateAsset(uploadId, { progress: 75, assetId: createdAsset.id });

        await reanalyzeAssetAsync(createdAsset.id);
        updateAsset(uploadId, {
          progress: 100,
          status: 'analyzing',
          assetId: createdAsset.id,
        });
      } catch (error) {
        logError('upload.processFile', error, {
          feature: 'upload',
          extra: {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          },
        });
        updateAsset(uploadId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
    [uploadFileAsync, createAssetAsync, reanalyzeAssetAsync, updateAsset]
  );

  // Process files with concurrency limit to avoid freezing on mobile
  const uploadQueueRef = useRef<File[]>([]);
  const activeUploadsRef = useRef(0);

  const drainQueue = useCallback(() => {
    while (
      activeUploadsRef.current < MAX_CONCURRENT_UPLOADS &&
      uploadQueueRef.current.length > 0
    ) {
      const file = uploadQueueRef.current.shift();
      if (!file) continue;
      activeUploadsRef.current++;
      processFile(file).finally(() => {
        activeUploadsRef.current--;
        drainQueue();
      });
    }
  }, [processFile]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!batchIdRef.current && files.length > 0) {
        try {
          const batch = await createBatchAsync({
            totalAssets: files.length,
          });
          batchIdRef.current = batch.id;
          setBatchId(batch.id);
        } catch {
          // Proceed without batch
        }
      }

      uploadQueueRef.current.push(...files);
      drainQueue();
    },
    [drainQueue, createBatchAsync]
  );

  // Expose addFiles for E2E testing — react-dropzone doesn't respond to
  // programmatic file input changes in React 19
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__e2eAddFiles = addFiles;
    return () => {
      (window as unknown as Record<string, unknown>).__e2eAddFiles = undefined;
    };
  }, [addFiles]);

  const removeAsset = useCallback(
    (id: string) => {
      setUploadedAssets((prev) => {
        const asset = prev.find((a) => a.id === id);
        if (asset) {
          URL.revokeObjectURL(asset.objectUrl);
        }
        if (asset?.assetId) untrackAnalysis([asset.assetId]);
        return prev.filter((a) => a.id !== id);
      });
    },
    [untrackAnalysis]
  );

  return (
    <UploadContext.Provider
      value={{
        batchId,
        uploadedAssets,
        addFiles,
        removeAsset,
        isAllUploadsComplete,
        hasActiveUploads,
        completedCount,
        processingCount,
        totalCount: uploadedAssets.length,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
