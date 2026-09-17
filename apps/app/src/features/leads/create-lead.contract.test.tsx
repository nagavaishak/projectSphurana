import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /leads` — create client.
 *
 * Four surfaces build this body: the unified `/create/customer` editor (the
 * Clients page's primary action), the in-context {@link CreateLeadDialog}
 * quick-add, the mobile appointment funnel's "Create New Client" screen, and
 * the add-booking drawer's "New client" step. All four render the one shared
 * {@link useCreateLeadForm} controller and the one set of field components, and
 * pass typed intent to the one `buildCreateLeadPayload`.
 *
 * The harness fills every field the form DECLARES — not a hand-written list, so
 * it cannot quietly omit the field that was dropped — and checks the four
 * properties. See `@/test/form-contract/harness`.
 */

// jsdom shims for Radix Select + vaul Drawer.
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

// vaul's drag physics read layout jsdom can't provide. Stub the Drawer to a
// minimal `open`-gated passthrough — the funnel's step logic and the shared
// create form stay real; only the drag/animation shell is replaced.
vi.mock('vaul', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (v: boolean) => void;
  }>({ open: false, setOpen: () => {} });
  const Root = ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (
    <Ctx.Provider value={{ open: !!open, setOpen: (v) => onOpenChange?.(v) }}>
      {children}
    </Ctx.Provider>
  );
  const Trigger = ({ children }: { children: React.ReactNode }) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only stub
      <div onClick={() => setOpen(true)}>{children}</div>
    );
  };
  const Portal = ({ children }: { children: React.ReactNode }) => {
    const { open } = React.useContext(Ctx);
    return open ? <>{children}</> : null;
  };
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root,
      Trigger,
      Portal,
      Overlay: Pass,
      Content: Pass,
      Title: Pass,
    },
  };
});

const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/providers', () => ({ trackEvent: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4). These surfaces
  // live under `/dashboard/l/:locationId/calendar`, so the mock reports a
  // pathname from there — `useBranchRoutes()` throws outside a branch, and
  // rightly so: a component that builds branch links without one is a bug.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      location: { pathname: '/dashboard/l/test-location/calendar/new' },
    }),
}));

vi.mock('@/features/mobile-dashboard-header', () => ({
  useMobileDashboardHeaderContent: () => undefined,
}));

// Creating a lead in the drawer advances to the service-picker step. That is a
// different surface; stub it so its fetching doesn't raise after we've captured.
vi.mock(
  '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-mobile-service-picker',
  () => ({ AppointmentMobileServicePicker: () => null })
);

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';
import { AppointmentMobileCreateClient } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-mobile-create-client';
import { MobileAddBookingFlow } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/mobile/mobile-add-booking-flow';
import { buildCreateLeadPayload } from './api/create-lead/create-lead.payload';
import { CreateLeadDialog } from './components/create-lead-dialog';
import { createLeadForm } from './components/create-lead-schema';

/** Every surface renders the same shared fields component, so one walk fits all. */
const fillAndSubmit = async (
  ctx: {
    fillRest: () => Promise<void>;
    user: import('@testing-library/user-event').UserEvent;
  },
  submit: RegExp
) => {
  await ctx.fillRest();
  await ctx.user.click(screen.getByRole('button', { name: submit }));
  await waitFor(() => expect(post).toHaveBeenCalled());
};

runFormContract({
  operation: 'POST leads',
  description: 'Create lead / client',
  form: createLeadForm,

  fills: {
    // The tag chips are a bespoke type-and-Enter input with no labelled control.
    tags: async (user) => {
      const input = screen.getByPlaceholderText(/type a tag and press enter/i);
      for (const tag of ['vip']) await user.type(input, `${tag}{Enter}`);
    },
  },

  surfaces: [
    {
      // The primary create surface. The editor renders the same field
      // components in its own rows, so filling it is the identical walk.
      name: 'unified /create/customer editor',
      run: async (ctx) => {
        renderWithProviders(
          <EntityEditorRoute mode="create" slug="customer" />
        );
        await screen.findByLabelText('First Name *');
        await ctx.fillRest();
        // The shared chrome renders the desktop Save AND the mobile sticky-bar
        // Save; both submit the one form, so either will do — pick the first
        // deterministically rather than matching both.
        await ctx.user.click(
          screen.getAllByRole('button', { name: /^save/i })[0]
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'desktop CreateLeadDialog',
      run: async (ctx) => {
        renderWithProviders(<CreateLeadDialog />);
        await ctx.user.click(
          screen.getByRole('button', { name: /create lead/i })
        );
        await screen.findByRole('dialog');
        await fillAndSubmit(ctx, /create lead/i);
      },
    },
    {
      name: 'mobile appointment new-client',
      run: async (ctx) => {
        renderWithProviders(
          <AppointmentMobileCreateClient
            search={{
              date: '2026-01-01',
              hour: 9,
              minute: 0,
              practitionerId: 'prac-1',
            }}
          />
        );
        await fillAndSubmit(ctx, /create lead/i);
      },
    },
    {
      name: 'mobile add-booking drawer',
      run: async (ctx) => {
        renderWithProviders(
          <MobileAddBookingFlow>
            <button type="button">Open</button>
          </MobileAddBookingFlow>
        );
        await ctx.user.click(screen.getByRole('button', { name: 'Open' }));
        await ctx.user.click(await screen.findByText('New client'));
        await screen.findByText('Client Profile');
        await fillAndSubmit(ctx, /save profile/i);
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'new-lead' });
    // The drawer's client-search step lists leads on mount.
    get.mockReset();
    get.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  },

  buildBody: buildCreateLeadPayload,

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'leads');
    if (!call) throw new Error('no POST leads call captured');
    return call[1] as Record<string, unknown>;
  },

  // Derived from the field samples, plus the keys the form does not render:
  //  - `consentSource` is computed by the builder — stamped only when a channel
  //    was actually consented to.
  //  - `status` is a `.default('new')` on the canonical request contract
  //    (`@borradh-workspace/contracts`), so parsing the body materialises it.
  //    The server defaulted it to the same value before; it is now explicit on
  //    the wire.
  expectedBody: () =>
    expectedFromFields(createLeadForm.fields, {
      consentSource: 'manual_entry',
      status: 'new',
    }),
});
