import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST videos/generate-organic-copy` — AI-write the on-screen
 * copy for an organic video.
 *
 * The operation has no copy inputs of its own (that is the point — the AI writes
 * them). Its body is exactly the two choices the user makes before pressing
 * Generate: the TEMPLATE (1:1 with the wire's `variationId`) and the SERVICE.
 * Those two are the form; see `generate-organic-copy.form`.
 *
 * Driven through {@link GenerateOrganicVideoDialog}, the surface where a user
 * makes both choices explicitly.
 *
 * THE OTHER ENTRY POINTS ARE NOT PARITY SURFACES, and cannot be:
 *   - `generate-video-dialog` / `new-post-dialog` fire the same call, but their
 *     `variationId` comes from the picked template's FIRST variation and their
 *     `serviceId` from that dialog's own service picker — same body SHAPE, and
 *     the one `buildGenerateOrganicCopyPayload` guarantees the envelope.
 *   - the review-modal re-roll adds `refinementInstruction` + `priorCopy` from
 *     an already-generated video's context. That is deliberately a DIFFERENT
 *     body, so property 4 (all surfaces build an identical body) is not the
 *     invariant for it.
 */

// jsdom shims for Radix Select / Dialog.
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
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ cdnUrl: 'https://cdn.test' }),
}));

import { GenerateOrganicVideoDialog } from '@/features/socials/components/generate-organic-video-dialog';
import { generateOrganicCopyForm } from './api/generate-organic-copy';

const SERVICE = { id: 'svc-1', name: 'Lip Filler', category: 'treatment' };

const ASSETS = Array.from({ length: 6 }, (_, i) => ({
  id: `asset-${i}`,
  name: `Clip ${i}`,
  type: 'video',
  blobUrl: `https://cdn.test/clip-${i}.mp4`,
  thumbnailUrl: null,
  tags: [],
}));

runFormContract({
  operation: 'POST videos/generate-organic-copy',
  description: 'Generate organic copy',
  form: generateOrganicCopyForm,

  fills: {
    // The template picker is a grid of cards, not a labelled control.
    variationId: async (user) => {
      await user.click(
        screen.getByRole('button', { name: /service improves/i })
      );
    },
  },

  surfaces: [
    {
      name: 'generate-organic-video-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <GenerateOrganicVideoDialog open onOpenChange={() => {}} />
        );
        await screen.findByText(/generate organic video/i);

        // The Service control only mounts once the services query resolves.
        // Wait for it explicitly — it used to arrive incidentally, during the
        // delays userEvent inserted between keystrokes elsewhere in the drive.
        await screen.findByLabelText(/^service$/i);

        // Picking the service loads its footage; the dialog then auto-selects
        // the template's recommended clip count, which enables Generate.
        await ctx.fill('serviceId', 'variationId');

        const generate = await screen.findByRole('button', {
          name: /^generate$/i,
        });
        await vi.waitFor(() => expect(generate).toBeEnabled());
        await ctx.user.click(generate);
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockImplementation((path: string) => {
      if (path === 'videos/generate-organic-copy') {
        return Promise.resolve({
          kind: 'improves',
          config: { serviceName: 'Lip Filler', items: ['a'], ctaText: 'Book' },
        });
      }
      return Promise.resolve({ id: 'vid-1' });
    });

    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('organization-services')) {
        return Promise.resolve({
          items: [SERVICE],
          total: 1,
          limit: 100,
          offset: 0,
        });
      }
      if (path.startsWith('assets/by-service/')) {
        return Promise.resolve({ items: ASSETS });
      }
      return Promise.resolve({
        items: ASSETS,
        total: ASSETS.length,
        limit: 60,
        offset: 0,
      });
    });
  },

  readBody: () => {
    const call = post.mock.calls.find(
      (c) => c[0] === 'videos/generate-organic-copy'
    );
    if (!call) throw new Error('no POST videos/generate-organic-copy captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => expectedFromFields(generateOrganicCopyForm.fields),
});
