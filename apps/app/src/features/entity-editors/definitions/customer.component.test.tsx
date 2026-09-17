import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `customer` entity editor.
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). It
 * proves the editor RENDERS and RESPONDS. It deliberately does NOT assert the
 * request body: that is the form contract's job
 * (`src/features/leads/create-lead.contract.test.tsx`), which drives this
 * editor alongside the quick-add dialog and the two mobile funnels and asserts
 * all four produce the same `POST /leads`.
 *
 * Short on purpose — the chrome, section navigation, layout, scroll behaviour
 * and save bar are proven once in the shared harness.
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

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    post: vi.fn().mockResolvedValue({ id: 'lead_1' }),
    put: vi.fn().mockResolvedValue({ id: 'lead_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
} from '../testing/render-entity-editor';

describe('customer entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('customer');

    // One section, so there is no section nav to assert — the editor's
    // sections are jobs, and creating a client is one job.
    await expectEditorChrome({ title: /add customer/i });
  });

  it('shows the create-client fields', async () => {
    renderEntityEditor('customer');

    expect(await screen.findByLabelText('First Name *')).toBeInTheDocument();
    expect(screen.getByLabelText('Last Name')).toBeInTheDocument();
    // "Email" is also a consent checkbox's label, so pin this to the input.
    expect(
      screen.getByLabelText('Email', { selector: 'input[name="email"]' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    // The consent block is one custom field, so its own heading is what proves
    // it reached the page.
    expect(screen.getByText('Contact Consent')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('customer');

    const firstName = await screen.findByLabelText('First Name *');
    await user.type(firstName, 'Ada');

    expect(firstName).toHaveValue('Ada');
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('customer');
    await screen.findByLabelText('First Name *');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
