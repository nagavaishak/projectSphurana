import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /assets` — the mass video upload.
 *
 * FORM-LESS, and a DIFFERENT body from the plain `POST assets`: the mass-upload
 * dialog groups its files into an upload BATCH (so face-grouping can run across
 * them) and stamps the raw/edited `source` the user chose with the "raw
 * footage" switch — `raw` queues AI tagging, `edited` skips it. Nothing else
 * about the asset is typed in, so properties 1 and 2 have nothing to check; 3
 * pins that the batch id and the source actually reach the wire.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
URL.createObjectURL ??= () => 'blob:preview';
URL.revokeObjectURL ??= () => {};

const { post, BLOB_URL, BATCH_ID } = vi.hoisted(() => ({
  post: vi.fn(),
  BLOB_URL: 'https://cdn.example.com/uploads/abc.mp4',
  BATCH_ID: 'batch-1',
}));

const videoFile = () =>
  new File(['x'], 'my clip.mp4', {
    type: 'video/mp4',
    lastModified: Date.parse('2026-01-02T03:04:05.000Z'),
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

// `useCreateAsset` and `useCreateUploadBatch` stay REAL — the batch id the
// dialog stamps onto the asset comes from the batch it just created.
vi.mock('@/features/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/assets')>()),
  useListAssets: () => ({ assets: [], isLoading: false }),
  useGetAssetAnalysis: () => ({ analysis: null }),
}));

vi.mock('@/features/face-groups', () => ({ BatchFaceGroups: () => null }));

vi.mock('@/features/upload', () => ({
  useUploadFile: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
    isUploading: false,
  }),
}));

import { MassVideoUploadDialog } from '@/features/assets/components/mass-video-upload-dialog';

runFormContract({
  operation: 'POST assets (mass video upload)',
  description: 'Create asset — mass upload (batch + raw/edited source)',
  form: null,
  noForm:
    "Not a form. The body is derived from each dropped File plus the dialog's " +
    'own context — the upload batch it created for this drop, and the raw/edited ' +
    'source toggle. No asset field is typed in, so properties 1 and 2 have ' +
    'nothing to check.',

  surfaces: [
    {
      name: 'mass-video-upload-dialog',
      run: async (ctx) => {
        const { baseElement } = renderWithProviders(
          <MassVideoUploadDialog open onOpenChange={() => {}} />
        );
        await screen.findByRole('dialog');

        // Turn the "raw footage" switch OFF → these are edited/polished assets,
        // which the body must say so AI tagging is skipped for them.
        await ctx.user.click(screen.getByRole('switch'));

        const input = baseElement.querySelector('input[type="file"]');
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
    source: 'edited',
    placeholderTypes: [],
    capturedAt: undefined,
    batchId: BATCH_ID,
  }),
});
