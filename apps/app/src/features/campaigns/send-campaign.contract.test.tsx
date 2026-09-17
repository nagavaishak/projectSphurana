import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /campaigns` — create (and send) a messaging campaign.
 *
 * ONE surface builds this body: {@link CampaignComposer}. The phone used to get
 * a second component (`CampaignComposerMobile`) wrapping this very composer in
 * mobile chrome; the composer now renders inside the shared responsive
 * `DashboardPage`, so there is a single surface to hold to this contract. It
 * runs the one `useSendCampaign` orchestrator, which reuses-or-creates the
 * segment, posts the campaign, writes one message per active channel and
 * launches — every write owned by its payload builder, so the composer only
 * ever passes typed intent.
 *
 * The registered operation is the `POST campaigns` body. Only `channels` reaches
 * it verbatim; `audience` arrives as the created segment's id, `subject`/`body`
 * are carried to `POST campaigns/:id/messages`, and `name`/`type` are stamped by
 * the send flow — hence the `derived` flags in {@link sendCampaignForm} and the
 * spelled-out `extra` below.
 */

// Radix (alert-dialog, sheet) needs these in jsdom.
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

const post = vi.fn();
const get = vi.fn();
// Stub only the HTTP `apiClient`; keep the PURE content kit real
// (`renderCampaignEmailHtml`, `CANONICAL_WHATSAPP_TEMPLATE`,
// `resolveCampaignWhatsappTemplate`, `fillWhatsappTemplate`) so the composer's
// WhatsApp resolve + the live preview it renders in the confirm dialog run for
// real — that is what the redesigned two-column composer now depends on.
vi.mock('@borradh-workspace/api-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@borradh-workspace/api-client')>();
  return {
    ...actual,
    apiClient: {
      post: (...args: unknown[]) => post(...args),
      get: (...args: unknown[]) => get(...args),
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

vi.mock('@/features/billing/api', () => ({
  useGetCreditBalance: () => ({ balance: { creditsAvailable: 100 } }),
}));

// WhatsApp is deliverable for this org (an active WABA) and now enabled
// (`ENABLED_CHANNELS`), so the composer offers both an Email and a WhatsApp
// chip. The channels fill toggles WhatsApp off, so the send lands on the
// `['email']` subset — a genuine two-chip → one-chip toggle.
vi.mock('@/features/integrations/api', () => ({
  useListWhatsAppAccounts: () => ({
    accounts: [{ id: 'wa-1', isActive: true }],
  }),
}));

vi.mock('@/features/leads/components/create-lead-dialog', () => ({
  CreateLeadDialog: () => null,
}));

// Mobile chrome — the mobile composer only wraps the shared component.
vi.mock('@/features/mobile-dashboard-header', () => ({
  useMobileDashboardHeaderContent: () => undefined,
}));
vi.mock('@/features/mobile-ui', () => ({
  MobileListPage: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));

import { sendCampaignForm } from './api/send-campaign';
import { CampaignComposer } from './components/campaign-composer';

/** The one composer, walked once. */
const fillAndSend = async (ctx: {
  fill: (
    ...keys: ('audience' | 'body' | 'subject' | 'channels')[]
  ) => Promise<void>;
  user: import('@testing-library/user-event').UserEvent;
}) => {
  // Reach resolves before any chip or the email-subject input can exist.
  await screen.findByRole('button', { name: /email · 5/i });

  await ctx.fill('audience');
  // The subject input only mounts once email is an active channel.
  await screen.findByLabelText(/^\s*Email subject\s*$/i);

  await ctx.fill('body', 'subject', 'channels');

  await ctx.user.click(screen.getByRole('button', { name: /send to/i }));
  await ctx.user.click(
    await screen.findByRole('button', { name: /send now/i })
  );

  await waitFor(() =>
    expect(post.mock.calls.some((c) => c[0] === 'campaigns')).toBe(true)
  );
};

runFormContract({
  operation: 'POST campaigns',
  description: 'Create messaging campaign',
  form: sendCampaignForm,

  fills: {
    // Audience is a chip row of presets + saved segments, not a labelled input.
    audience: async (user) => {
      await user.click(screen.getByRole('button', { name: 'New leads' }));
    },
    // Channels are auto-included chips. Email and WhatsApp are both offered
    // (`ENABLED_CHANNELS`, and this org has an active WABA), so toggle the
    // WhatsApp chip off to land on the `['email']` subset — a genuine subset
    // toggle that proves the control is reachable and wired.
    channels: async (user) => {
      // Reach resolves both chips first.
      await screen.findByRole('button', { name: /email · 5/i });
      const whatsappChip = await screen.findByRole('button', {
        name: /whatsapp · 3/i,
      });
      await user.click(whatsappChip);
      await screen.findByRole('button', { name: /send to 5 people/i });
    },
  },

  surfaces: [
    {
      name: 'campaign-composer',
      run: async (ctx) => {
        renderWithProviders(<CampaignComposer />);
        await fillAndSend(ctx);
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockImplementation(async (url: string) => {
      // Live reach is a query, not part of any send payload.
      if (url === 'campaigns/segments/preview') {
        return {
          total: 8,
          reachable: 5,
          channels: { email: 5, sms: 0, whatsapp: 3 },
        };
      }
      if (url === 'campaigns/segments') return { id: 'seg-1' };
      if (url === 'campaigns') return { id: 'camp-1' };
      if (url.endsWith('/launch')) {
        return { campaignId: 'camp-1', materialized: 5, enqueued: 5 };
      }
      return {};
    });

    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === 'campaigns/segments') {
        return { items: [], total: 0, limit: 0, offset: 0 };
      }
      if (url === 'campaigns/sms-number') return null;
      return {};
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'campaigns');
    if (!call) throw new Error('no POST campaigns call captured');
    return call[1] as Record<string, unknown>;
  },

  // `channels` is the only field that lands on this body verbatim. The rest of
  // it is computed by the send flow: the audience became segment `seg-1`, and
  // the name/type are stamped ("Message — <date>", always a custom campaign).
  expectedBody: () =>
    expectedFromFields(sendCampaignForm.fields, {
      name: expect.stringMatching(/^Message — /) as unknown as string,
      type: 'custom',
      segmentId: 'seg-1',
    }),
});
