import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Component tests for the invited-member accept flow. We drive the real
 * orchestrator with the feature hooks mocked, proving:
 *  - Review step prefills First/Last/Mobile from the invite lookup.
 *  - The Terms checkbox gates progression to the Password/Accept step.
 *  - The happy path calls the accept mutation with `acceptedTerms: true`.
 *  - Loading / expired / NOT_FOUND states render on the Join screen.
 *
 * The wizard that follows accept is a separate unit - stubbed here to a marker.
 */

// Radix Select (used by the country field) observes element size at mount.
// jsdom has no ResizeObserver — provide a no-op so the step renders.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const useInvitationByToken = vi.fn();
const acceptInvitationAsync = vi.fn();
const signUpAsync = vi.fn();
const useSessionMock = vi.fn();

vi.mock('@/features/organization/api', () => ({
  useInvitationByToken: (...a: unknown[]) => useInvitationByToken(...a),
  useAcceptInvitation: () => ({ acceptInvitationAsync }),
}));

vi.mock('@/features/auth/use-sign-up', () => ({
  useSignUp: () => ({ signUpAsync }),
}));

vi.mock('@/features/organization/api/set-active-organization', () => ({
  setActiveOrganizationIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/session', () => ({
  useSession: () => useSessionMock(),
  refetchSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Stub the wizard so the accept test doesn't pull in practitioner fetching.
vi.mock('../team-member-wizard', () => ({
  TeamMemberWizard: () => <div data-testid="wizard">wizard</div>,
}));

import { AcceptInvitationFlow } from './accept-invitation-flow';

const CONTINUE = { name: /^continue$/i } as const;

const PENDING_INVITE = {
  id: 'inv-1',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  organizationId: 'org-1',
  organizationName: 'Glow Studio',
  inviterName: 'Grace Hopper',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+15550000000',
  phoneCountry: 'us',
  country: 'us',
};

function mockInvitation(overrides: Record<string, unknown> = {}) {
  useInvitationByToken.mockReturnValue({
    invitation: PENDING_INVITE,
    isLoading: false,
    isError: false,
    error: null,
    ...overrides,
  });
}

describe('AcceptInvitationFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptInvitationAsync.mockResolvedValue({ organizationId: 'org-1' });
    signUpAsync.mockResolvedValue({ user: { id: 'u1' } });
    useSessionMock.mockReturnValue({ data: { user: null } });
    window.sessionStorage.clear();
  });

  it('shows a loading state while the invite is being looked up', () => {
    useInvitationByToken.mockReturnValue({
      invitation: null,
      isLoading: true,
      isError: false,
      error: null,
    });
    const { container } = renderWithProviders(
      <AcceptInvitationFlow token="tok" />
    );
    expect(screen.queryByText(/Join Glow Studio/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('renders an error state for a NOT_FOUND / invalid invite', () => {
    useInvitationByToken.mockReturnValue({
      invitation: null,
      isLoading: false,
      isError: true,
      error: new Error('Invitation not found'),
    });
    renderWithProviders(<AcceptInvitationFlow token="tok" />);
    expect(screen.getByText(/Invitation unavailable/i)).toBeInTheDocument();
  });

  it('renders an expired state when the invite has lapsed', () => {
    mockInvitation({
      invitation: {
        ...PENDING_INVITE,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    renderWithProviders(<AcceptInvitationFlow token="tok" />);
    expect(screen.getByText(/has expired/i)).toBeInTheDocument();
  });

  it('prefills the Review step from the invite lookup', async () => {
    const user = userEvent.setup();
    mockInvitation();
    renderWithProviders(<AcceptInvitationFlow token="tok" />);

    await user.click(screen.getByRole('button', CONTINUE)); // Join -> Review

    const firstName = await screen.findByLabelText(/first name/i);
    expect(firstName).toHaveValue('Ada');
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Lovelace');
    expect(screen.getByLabelText(/mobile number/i)).toHaveValue('+15550000000');
  });

  it('gates the Password step behind the Terms checkbox', async () => {
    const user = userEvent.setup();
    mockInvitation();
    renderWithProviders(<AcceptInvitationFlow token="tok" />);

    await user.click(screen.getByRole('button', CONTINUE)); // Join -> Review
    await screen.findByLabelText(/first name/i);

    // Continue without accepting terms -> blocked, still on Review.
    await user.click(screen.getByRole('button', CONTINUE));
    expect(screen.getByText(/must accept the terms/i)).toBeInTheDocument();
    expect(screen.queryByText(/Set a password/i)).not.toBeInTheDocument();

    // Accept terms -> advances to Password.
    await user.click(screen.getByRole('checkbox', { name: /accept terms/i }));
    await user.click(screen.getByRole('button', CONTINUE));
    expect(await screen.findByText(/Set a password/i)).toBeInTheDocument();
  });

  it('accepts the invite with acceptedTerms on the happy path', async () => {
    const user = userEvent.setup();
    mockInvitation();
    renderWithProviders(<AcceptInvitationFlow token="tok" />);

    await user.click(screen.getByRole('button', CONTINUE)); // Join -> Review
    await screen.findByLabelText(/first name/i);
    await user.click(screen.getByRole('checkbox', { name: /accept terms/i }));
    await user.click(screen.getByRole('button', CONTINUE)); // Review -> Password

    await screen.findByText(/Set a password/i);
    await user.type(screen.getByLabelText(/^password$/i), 'sup3rsecret');
    await user.type(screen.getByLabelText(/confirm password/i), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: /accept invite/i }));

    await waitFor(() => {
      expect(signUpAsync).toHaveBeenCalledWith({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'sup3rsecret',
      });
    });
    expect(acceptInvitationAsync).toHaveBeenCalledWith({
      invitationId: 'inv-1',
      acceptedTerms: true,
    });
    expect(await screen.findByTestId('wizard')).toBeInTheDocument();
  });
});
