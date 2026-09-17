import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { MembershipPlanWithServices } from '@borradh-workspace/api-client/types';
import {
  fixture,
  membershipPlanWithServicesSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/memberships.spec.ts create → edit-name flow, now on
// the UNIFIED editor (`/create/membership`, `/edit/membership/:id`) rather than
// the deleted dialog. The editor reads services (useListServices) and org
// currency (useOrgCurrency) through apiClient.get — both resolve to
// `{ items: [] }` here — and writes through create/update membership-plan
// hooks.
const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

import { EntityFormPage } from '@/components/app/entity-editor';
import { toast } from 'sonner';
import { useMembershipEditor } from './use-membership-editor';

// Radix Select/Popover need browser APIs jsdom lacks.
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
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

/**
 * The registered editor exactly as the shared route mounts it — config + state
 * from the entity, chrome from `EntityFormPage`.
 */
function MembershipEditorHarness({
  plan = null,
}: {
  plan?: MembershipPlanWithServices | null;
}) {
  const editor = useMembershipEditor({ plan });
  return (
    <EntityFormPage
      config={editor.config}
      errors={editor.errors}
      isEdit={!!plan}
      isSaving={editor.isSaving}
      onCancel={editor.onCancel}
      onSave={editor.onSave}
      setValue={editor.setValue}
      values={editor.values}
    />
  );
}

const existingPlan: MembershipPlanWithServices = fixture(
  membershipPlanWithServicesSchema,
  {
    id: 'p1',
    organizationId: 'org_1',
    name: 'Gold membership',
    description: 'Ten sessions',
    serviceIds: [],
    sessionCount: 8,
    pricingType: 'one_time',
    validFor: '1m',
    priceCents: 12000,
    currency: 'eur',
    stripeProductId: null,
    stripePriceId: null,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
);

describe('membership editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ id: 'new-plan' });
    put.mockResolvedValue({ id: 'p1' });
    get.mockResolvedValue({ items: [] });
  });

  it('renders the core fields (name, sessions, price) in create mode', () => {
    renderWithProviders(<MembershipEditorHarness />);
    expect(
      screen.getByRole('heading', { name: 'Add membership' })
    ).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(screen.getByLabelText('Number of sessions')).toBeVisible();
    expect(screen.getByLabelText('Price')).toBeVisible();
  });

  it('rejects a blank name (no write)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipEditorHarness />);

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.type(screen.getByLabelText('Price'), '120.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('Name is required');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects an invalid (zero) price (no write)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipEditorHarness />);

    await user.type(screen.getByLabelText('Name'), 'Gold membership');
    await user.type(screen.getByLabelText('Price'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('Enter a valid price');
    expect(post).not.toHaveBeenCalled();
  });

  it('creates a plan converting price to cents and sessions to a number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipEditorHarness />);

    await user.type(screen.getByLabelText('Name'), 'Gold membership');
    await user.type(
      screen.getByLabelText('Description'),
      '10 sessions redeemable against services'
    );
    const sessions = screen.getByLabelText('Number of sessions');
    await user.clear(sessions);
    await user.type(sessions, '8');
    await user.type(screen.getByLabelText('Price'), '120.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'membership-plans',
      expect.objectContaining({
        name: 'Gold membership',
        description: '10 sessions redeemable against services',
        sessionCount: 8,
        pricingType: 'one_time',
        validFor: '1m',
        priceCents: 12000,
        currency: 'eur',
        isActive: true,
        serviceIds: [],
      })
    );
    // A successful save returns to the list.
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('hydrates the saved name in edit mode and sends the rename', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipEditorHarness plan={existingPlan} />);

    expect(
      screen.getByRole('heading', { name: 'Edit membership' })
    ).toBeVisible();
    const name = await screen.findByDisplayValue('Gold membership');
    await user.clear(name);
    await user.type(name, 'Gold membership RENAMED');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      'membership-plans/p1',
      expect.objectContaining({
        name: 'Gold membership RENAMED',
        sessionCount: 8,
        priceCents: 12000,
      })
    );
  });

  it('stays on the editor and toasts when the server rejects', async () => {
    post.mockRejectedValueOnce(new Error('server down'));
    const user = userEvent.setup();
    renderWithProviders(<MembershipEditorHarness />);

    await user.type(screen.getByLabelText('Name'), 'Gold membership');
    await user.type(screen.getByLabelText('Price'), '120.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('server down')
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
