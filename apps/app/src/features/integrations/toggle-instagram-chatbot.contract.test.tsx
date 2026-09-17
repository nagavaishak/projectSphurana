import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT integrations/instagram/chatbot` — toggle the IG chatbot.
 *
 * THIS OPERATION HAS NO FORM, and that is a deliberate finding rather than a
 * convenience. Its one wire key, `enabled`, is never a field the user fills in:
 *
 *   - chatbot-page-toggles renders a bare `Switch` (aria-label "Toggle chatbot
 *     for Instagram") whose flip opens a confirm dialog; the value is the
 *     gesture, and it is `handleConfirm` — not a submit — that writes.
 *   - facebook-settings-dialog renders its OWN, differently-labelled switch
 *     ("Toggle Instagram chatbot") that writes optimistically on change.
 *   - instagram-chatbot-dialog has NO toggle at all: it is an enable-only
 *     onboarding prompt whose single "Enable" button means `true` by construction.
 *
 * So there is no shared label to locate and no shared control to drive — modelling
 * it as a one-field `switch` form would make property 2 fail on the third surface
 * for a control that was never meant to exist. `form: null` + `noForm` is the
 * honest shape: properties 1 and 2 have nothing to check, and 3 (payload correct)
 * and 4 (surfaces agree) still do — all three surfaces must route their intent
 * through the one `buildToggleInstagramChatbotPayload`.
 *
 * The `false` direction — the drift the old parity spec was written for, when the
 * dialog hardcoded `enabled: true` — is pinned below the harness, since the
 * harness proves one body per operation.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const put = vi.fn();
const get = vi.fn(async (url: string) => {
  if (url === 'integrations/instagram/integration') {
    return { integration: mockIgIntegration };
  }
  if (url === 'integrations/meta-ads/pages') return { pages: [] };
  if (url === 'integrations/whatsapp/accounts') return { accounts: [] };
  return null;
});

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...(args as [string])),
    post: vi.fn(),
    put: (...args: unknown[]) => put(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useSearch: () => ({ instagram: 'connected' }),
}));

import { FacebookSettingsDialog } from '@/features/integrations-dashboard/components/dialogs/facebook-settings-dialog';
import { InstagramChatbotDialog } from '@/features/integrations-dashboard/components/dialogs/instagram-chatbot-dialog';
import { ChatbotPageToggles } from '@/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/chatbot-page-toggles';

/**
 * Served to the REAL `useGetInstagramIntegration` through the mocked
 * `apiClient.get`, so chatbot-page-toggles runs its own hooks and its own
 * render gates rather than a stub of them.
 */
let mockIgIntegration: Record<string, unknown> = {
  isActive: true,
  chatbotEnabled: false,
  username: 'acme.clinic',
  name: 'Acme',
};

const ENDPOINT = 'integrations/instagram/chatbot';

runFormContract({
  operation: 'PUT integrations/instagram/chatbot',
  description: 'Toggle Instagram chatbot',

  form: null,
  noForm:
    'No shared form: two surfaces own separately-labelled switches and the third ' +
    'is an enable-only onboarding prompt with no toggle. `enabled` is a gesture, ' +
    'not a field — there is nothing for properties 1 and 2 to check.',

  surfaces: [
    {
      name: 'chatbot-page-toggles',
      run: async (ctx) => {
        mockIgIntegration = {
          isActive: true,
          chatbotEnabled: false,
          username: 'acme.clinic',
          name: 'Acme',
        };
        renderWithProviders(<ChatbotPageToggles />);

        await ctx.user.click(
          await screen.findByRole('switch', {
            name: /toggle chatbot for instagram/i,
          })
        );
        // The flip only stages the change; the confirm dialog performs the write.
        await ctx.user.click(
          await screen.findByRole('button', { name: /^enable$/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      name: 'facebook-settings-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <FacebookSettingsDialog
            instagram={{
              username: 'acme.clinic',
              name: 'Acme',
              chatbotEnabled: false,
            }}
            onOpenChange={() => {}}
            open
          />
        );

        await ctx.user.click(
          screen.getByRole('switch', { name: /toggle instagram chatbot/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      name: 'instagram-chatbot-dialog',
      run: async (ctx) => {
        renderWithProviders(<InstagramChatbotDialog />);

        await ctx.user.click(
          await screen.findByRole('button', { name: /^enable$/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue({ isChatbotActive: true });
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === ENDPOINT);
    if (!call) throw new Error(`no PUT ${ENDPOINT} call captured`);
    return call[1] as Record<string, unknown>;
  },

  // One boolean, and the enabling gesture is the one every surface can make.
  expectedBody: () => ({ enabled: true }),
});

/**
 * The harness proves ONE body per operation, so the disabling direction is
 * pinned here. It is the exact regression the operation was consolidated for:
 * a surface that means "off" must actually send `false`, not the `true` the
 * onboarding dialog used to hardcode into every caller's shape.
 */
describe('PUT integrations/instagram/chatbot — the disabling gesture', () => {
  beforeEach(() => {
    put.mockReset();
    put.mockResolvedValue({ isChatbotActive: false });
  });

  it('sends `enabled: false` when the switch is turned OFF', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FacebookSettingsDialog
        instagram={{
          username: 'acme.clinic',
          name: 'Acme',
          chatbotEnabled: true,
        }}
        onOpenChange={() => {}}
        open
      />
    );

    await user.click(
      screen.getByRole('switch', { name: /toggle instagram chatbot/i })
    );

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith(ENDPOINT, { enabled: false });
  });
});
