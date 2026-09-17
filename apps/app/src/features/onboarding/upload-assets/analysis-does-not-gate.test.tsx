import { renderWithProviders, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

/**
 * AI tagging must not gate the upload funnel.
 *
 * The funnel used to hold the user on step 0 until every analysis reached a
 * terminal status, and the mass-upload dialog refused to close for the same
 * reason. That is a wait the client does not control: analysis is queued work,
 * and production has completed analyses 84 minutes after upload, almost all of
 * it queue wait. Tagging now runs in the background, so an asset sitting in
 * `analyzing` must leave the funnel free to advance.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
URL.createObjectURL ??= () => 'blob:preview';
URL.revokeObjectURL ??= () => {};

const { post, BLOB_URL, ASSET_ID } = vi.hoisted(() => ({
  post: vi.fn(),
  BLOB_URL: 'https://cdn.example.com/uploads/abc.mp4',
  ASSET_ID: 'asset-1',
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    put: vi.fn(),
    // The analysis never resolves: this is the stuck-in-queue case.
    get: vi.fn().mockResolvedValue({ assets: [], summary: {} }),
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
import {
  UploadProvider,
  useUploadContext,
} from '@/features/onboarding/upload-assets/upload-context';

function GateProbe() {
  const { isAllUploadsComplete, uploadedAssets } = useUploadContext();
  return (
    <div>
      <span data-testid="can-continue">{String(isAllUploadsComplete)}</span>
      <span data-testid="statuses">
        {uploadedAssets.map((a) => a.status).join(',')}
      </span>
    </div>
  );
}

it('lets the funnel continue while an asset is still being tagged', async () => {
  post.mockImplementation((path: string) => {
    if (path === 'assets/batch') return Promise.resolve({ id: 'batch-1' });
    if (path === `assets/${ASSET_ID}/analyze`) return Promise.resolve({});
    return Promise.resolve({
      id: ASSET_ID,
      name: 'my clip',
      blobUrl: BLOB_URL,
      thumbnailUrl: null,
      type: 'video',
    });
  });

  const user = userEvent.setup();
  const { container, getByTestId } = renderWithProviders(
    <UploadProvider>
      <StepUpload />
      <GateProbe />
    </UploadProvider>
  );

  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input rendered');

  await user.upload(
    input as HTMLInputElement,
    new File(['x'], 'my clip.mp4', { type: 'video/mp4' })
  );

  // The asset reaches `analyzing` and stays there — the worker never answers.
  await waitFor(() =>
    expect(getByTestId('statuses').textContent).toBe('analyzing')
  );

  // …and the funnel is free to move on anyway. Before this change the gate
  // read `isAllAnalysisComplete`, which would be false here for as long as the
  // analysis queue was backed up.
  expect(getByTestId('can-continue').textContent).toBe('true');
});
