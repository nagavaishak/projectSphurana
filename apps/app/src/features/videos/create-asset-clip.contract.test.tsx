import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { useForm } from 'react-hook-form';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /assets` — the create-video clip upload.
 *
 * FORM-LESS, and a DIFFERENT body from the plain `POST assets` operation: an
 * asset uploaded into a video slot is tagged `['background']` so it comes back
 * in the clip pickers. Three surfaces do it — the single-clip slot, the
 * background video-selection dialog, and the media-selection step — and all
 * three must produce the SAME tagged body from the same File. (The
 * media-selection step also prepends the slot's `filterTag` when the slot has
 * one; with no filter tag it must land on exactly the same body as the others,
 * which is what this pins.)
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

const { post, BLOB_URL } = vi.hoisted(() => ({
  post: vi.fn(),
  BLOB_URL: 'https://cdn.example.com/uploads/abc.mp4',
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

// `useCreateAsset` — the thing under test — stays REAL.
vi.mock('@/features/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/assets')>()),
  useListAssets: () => ({
    assets: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useListAssetsByService: () => ({ assets: [], isLoading: false }),
  useGetAsset: () => ({ asset: null }),
}));

vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services: [], isLoading: false }),
}));

const upload = {
  uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
  isUploading: false,
};
vi.mock('@/features/upload', () => ({
  useUploadFile: () => upload,
  useUploadImage: () => upload,
  useUploadVideo: () => upload,
}));
vi.mock('@/features/upload/api/upload.hook', () => ({
  useUploadFile: () => upload,
  useUploadImage: () => upload,
  useUploadVideo: () => upload,
}));

import type { SlotConfig } from '@/routes/_authed/create-video/$templateId/-components/data/-slot-config';
import { VideoSelectionDialog } from '@/routes/_authed/create-video/$templateId/-components/dialogs/video-selection-dialog';
import { SingleClipSlot } from '@/routes/_authed/create-video/$templateId/-components/shared/single-clip-slot';
import { MediaSelectionStep } from '@/routes/_authed/create-video/$templateId/-components/steps/media-selection-step';
import { VideoCreationProvider } from '@/routes/_authed/create-video/$templateId/-context';
import type { VideoFormData } from '@/routes/_authed/create-video/$templateId/-schema';

/** A slot with NO filterTag — so every surface must send exactly ['background']. */
const SLOT: SlotConfig = {
  type: 'bRoll',
  label: 'Background Footage',
  description: 'B-roll clips to show during your video',
  required: false,
  maxCount: 5,
  order: 0,
};

function MediaSelectionStepHarness() {
  const form = useForm<VideoFormData>({ defaultValues: {} as never });
  // MediaSelectionStep reads `templateId` off the wizard context (it drives the
  // stock-clip picker), so this surface must render inside the provider — the
  // same way the wizard route renders it.
  return (
    <VideoCreationProvider templateId="educational">
      <MediaSelectionStep form={form} slot={SLOT} />
    </VideoCreationProvider>
  );
}

/** Each surface hides its upload behind one `input[type=file]`. */
const fileInputIn = (root: HTMLElement): HTMLInputElement => {
  const input = root.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input rendered on this surface');
  return input as HTMLInputElement;
};

runFormContract({
  operation: 'POST assets (video clip)',
  description: 'Create asset — background clip for a video slot',
  form: null,
  noForm:
    'Not a form. The user picks a File in a clip slot; the body is derived from ' +
    "that File plus the slot's context (the `background` tag). No field is " +
    'filled, so properties 1 and 2 have nothing to check — 3 and 4 do, and the ' +
    'three clip pickers must tag identically or an uploaded clip vanishes from ' +
    'the pickers that filter on the tag.',

  surfaces: [
    {
      name: 'create-video single-clip-slot',
      run: async (ctx) => {
        const { baseElement } = renderWithProviders(
          <SingleClipSlot
            slot={SLOT}
            selectedId={undefined}
            onSelect={() => {}}
          />
        );
        await ctx.user.click(
          screen.getByRole('button', {
            name: /select background footage video/i,
          })
        );
        await screen.findByRole('dialog');
        await ctx.user.upload(fileInputIn(baseElement), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'create-video video-selection-dialog',
      run: async (ctx) => {
        const { baseElement } = renderWithProviders(
          <VideoSelectionDialog
            open
            onOpenChange={() => {}}
            selectedIds={[]}
            onSelect={() => {}}
          />
        );
        await screen.findByRole('dialog');
        await ctx.user.upload(fileInputIn(baseElement), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'create-video media-selection-step',
      run: async (ctx) => {
        const { container } = renderWithProviders(
          <MediaSelectionStepHarness />
        );
        await ctx.user.upload(fileInputIn(container), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({
      id: 'asset-1',
      name: 'my clip',
      blobUrl: BLOB_URL,
      thumbnailUrl: null,
      type: 'video',
      tags: ['background'],
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
    tags: ['background'],
    source: 'raw',
    placeholderTypes: [],
    capturedAt: undefined,
    batchId: undefined,
  }),
});
