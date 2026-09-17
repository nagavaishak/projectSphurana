import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /assets` — the onboarding intake upload.
 *
 * FORM-LESS, and a DIFFERENT body from the plain `POST assets`: the intake
 * groups the drop into an upload BATCH (face grouping runs across it) and asks
 * the builder for `capturedAt` — the File's last-modified time — so the intake
 * gallery can be ordered chronologically. Nothing is typed in, so properties 1
 * and 2 have nothing to check; 3 pins that both of those actually reach the
 * wire, which is the only thing distinguishing this body from the plain one.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
URL.createObjectURL ??= () => 'blob:preview';
URL.revokeObjectURL ??= () => {};

const { post, BLOB_URL, BATCH_ID } = vi.hoisted(() => ({
  post: vi.fn(),
  BLOB_URL: 'https://cdn.example.com/uploads/abc.mp4',
  BATCH_ID: 'batch-1',
}));

const CAPTURED_AT = '2026-01-02T03:04:05.000Z';

const videoFile = () =>
  new File(['x'], 'my clip.mp4', {
    type: 'video/mp4',
    lastModified: Date.parse(CAPTURED_AT),
  });

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/providers', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/posthog-provider', () => ({
  trackEvent: vi.fn(),
  usePostHog: () => null,
}));

// `useCreateAsset` and `useCreateUploadBatch` stay REAL.
vi.mock('@/features/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/assets')>()),
  useListAssets: () => ({ assets: [], isLoading: false }),
}));

vi.mock('@/features/upload', () => ({
  useUploadFile: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
    isUploading: false,
  }),
}));

import { StepUpload } from '@/features/onboarding/upload-assets/steps/step-upload';
import { UploadProvider } from '@/features/onboarding/upload-assets/upload-context';

runFormContract({
  operation: 'POST assets (onboarding capture)',
  description: 'Create asset — onboarding intake (batch + capturedAt)',
  form: null,
  noForm:
    "Not a form. The body is derived from each dropped File plus the intake's " +
    "context — the upload batch, and the File's last-modified time persisted as " +
    '`capturedAt` so the gallery orders chronologically. Nothing is typed in.',

  surfaces: [
    {
      name: 'onboarding upload-assets intake',
      run: async (ctx) => {
        const { container } = renderWithProviders(
          <UploadProvider>
            <StepUpload />
          </UploadProvider>
        );
        const input = container.querySelector('input[type="file"]');
        if (!input) throw new Error('no file input rendered on this surface');
        await ctx.user.upload(input as HTMLInputElement, videoFile());
        await waitFor(() =>
          expect(post.mock.calls.some((c) => c[0] === 'assets')).toBe(true)
        );
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockImplementation((path: string) => {
      if (path === 'assets/batch') return Promise.resolve({ id: BATCH_ID });
      return Promise.resolve({
        id: 'asset-1',
        name: 'my clip',
        blobUrl: BLOB_URL,
        thumbnailUrl: null,
        type: 'video',
      });
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'assets');
    if (!call) throw new Error('no POST assets call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => ({
    name: 'my clip',
    sourceFileName: 'my clip.mp4',
    blobUrl: BLOB_URL,
    type: 'video',
    tags: [],
    source: 'raw',
    placeholderTypes: [],
    capturedAt: CAPTURED_AT,
    batchId: BATCH_ID,
  }),
});
