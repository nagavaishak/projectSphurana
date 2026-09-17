import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen } from '@/test/render';
import type { FaceGroupWithAssets } from '@borradh-workspace/api-client/types';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT face-groups/:id` — rename a detected client.
 *
 * Two surfaces type a client name and persist it: the batch review
 * {@link FaceGroupCard} (pencil → input → check) and the onboarding
 * before/after row (input → blur). Both hand `useUpdateFaceGroup` a bare intent
 * and the one `buildUpdateFaceGroupPayload` shapes the partial body.
 *
 * ONE PAYLOAD FIELD IS DELIBERATELY OUTSIDE THIS FORM — reported:
 *
 *  - `serviceId` — the onboarding row's service picker fires its OWN separate
 *    `PUT` carrying only `serviceId` (partial update). It is reachable, but it
 *    is not part of the same submitted body as `clientName`, and the batch card
 *    has no service picker at all. The harness models one body per surface, so
 *    a field that ships in a different request cannot be declared here.
 */

const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The onboarding step reads its batch id from the upload wizard's context; the
// wizard itself (file dnd + upload pipeline) is not part of this operation.
vi.mock('@/features/onboarding/upload-assets/upload-context', () => ({
  useUploadContext: () => ({ batchId: BATCH_ID }),
}));

// jsdom shims for Radix Select (the row's service picker renders one).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import { StepBeforeAfter } from '@/features/onboarding/upload-assets/steps/step-before-after';
import { FaceGroupCard } from './components/face-group-card';
import { updateFaceGroupForm } from './components/update-face-group-schema';

const BATCH_ID = 'batch-1';

const GROUP: FaceGroupWithAssets = {
  id: 'fg-1',
  organizationId: 'org-1',
  clientName: null,
  serviceId: null,
  assets: [],
};

runFormContract({
  operation: 'PUT face-groups/:id',
  description: 'Update face group',
  form: updateFaceGroupForm,

  surfaces: [
    {
      name: 'batch face-group card',
      run: async (ctx) => {
        renderWithProviders(<FaceGroupCard group={GROUP} />);
        // The group has no assets, so the pencil is the only button on screen.
        await ctx.user.click(screen.getByRole('button'));
        await ctx.fill('clientName');
        // In edit mode the sole button is the check / save.
        await ctx.user.click(screen.getByRole('button'));
      },
    },
    {
      name: 'onboarding before/after row',
      run: async (ctx) => {
        renderWithProviders(<StepBeforeAfter />);
        await screen.findByText(/matched pairs/i);
        await ctx.fill('clientName');
        // The row persists on blur.
        await ctx.user.tab();
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue({ ...GROUP, clientName: 'Alice Smith' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith(`face-groups/batch/${BATCH_ID}`)) {
        return Promise.resolve({
          faceGroups: [GROUP],
          status: 'complete',
        });
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 });
      }
      // assets/batch/:id — no unpaired assets to reconcile.
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
    });
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === `face-groups/${GROUP.id}`);
    if (!call) throw new Error('no PUT face-groups/:id call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => expectedFromFields(updateFaceGroupForm.fields),
});
