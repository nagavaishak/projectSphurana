import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  post,
  useSession,
  getAdminSessionToken,
  clearAdminSessionToken,
  setAuthTokenAndPersist,
  returnToAdminPanel,
  toastError,
} = vi.hoisted(() => ({
  post: vi.fn(),
  useSession: vi.fn(),
  getAdminSessionToken: vi.fn(),
  clearAdminSessionToken: vi.fn(),
  setAuthTokenAndPersist: vi.fn(),
  returnToAdminPanel: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { post },
}));

vi.mock('@/lib/session', () => ({
  useSession: () => useSession(),
}));

vi.mock('@/lib/admin-session-token', () => ({
  getAdminSessionToken: () => getAdminSessionToken(),
  clearAdminSessionToken: () => clearAdminSessionToken(),
}));

vi.mock('@/lib/auth-token', () => ({
  setAuthTokenAndPersist: (token: string) => setAuthTokenAndPersist(token),
}));

vi.mock('../lib/return-to-admin-panel', () => ({
  returnToAdminPanel: () => returnToAdminPanel(),
}));

vi.mock('sonner', () => ({
  toast: { error: (message: string) => toastError(message) },
}));

import { ImpersonationBanner } from './impersonation-banner';

function mockSession(impersonated = true) {
  useSession.mockReturnValue({
    data: {
      user: { email: 'person@example.com' },
      session: impersonated ? { impersonatedBy: 'admin-1' } : {},
    },
  });
}

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    getAdminSessionToken.mockReturnValue('saved-admin-session');
    setAuthTokenAndPersist.mockResolvedValue(undefined);
  });

  it('does not render outside an impersonated session', () => {
    mockSession(false);

    renderWithProviders(<ImpersonationBanner />);

    expect(
      screen.queryByRole('button', {
        name: 'Open return to admin panel controls',
      })
    ).not.toBeInTheDocument();
  });

  it('starts as a safe-area-aware launcher and opens the impersonation card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationBanner />);

    const launcher = screen.getByRole('button', {
      name: 'Open return to admin panel controls',
    });
    expect(launcher).not.toHaveTextContent('Back to admin panel');
    expect(launcher).toHaveClass('fixed');
    expect(launcher).toHaveClass('size-10');
    expect(launcher.className).toContain('safe-area-inset-bottom');
    expect(
      screen.queryByRole('dialog', { name: 'Admin impersonation controls' })
    ).not.toBeInTheDocument();

    await user.click(launcher);

    expect(
      screen.getByRole('dialog', { name: 'Admin impersonation controls' })
    ).toBeVisible();
    expect(screen.getByText('person@example.com')).toBeVisible();
  });

  it('can be dismissed by the close control, launcher, Escape, and outside click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationBanner />);
    const launcher = screen.getByRole('button', {
      name: 'Open return to admin panel controls',
    });

    await user.click(launcher);
    await user.click(
      screen.getByRole('button', {
        name: 'Close return to admin panel controls',
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(launcher);
    await user.click(launcher);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(launcher);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();

    await user.click(launcher);
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores the admin session before returning to the admin panel', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ token: 'restored-admin-token' });
    renderWithProviders(<ImpersonationBanner />);

    await user.click(
      screen.getByRole('button', {
        name: 'Open return to admin panel controls',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Back to admin panel' })
    );

    await waitFor(() => expect(returnToAdminPanel).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('admin-terminal/stop-impersonating', {
      adminSessionToken: 'saved-admin-session',
    });
    expect(setAuthTokenAndPersist).toHaveBeenCalledWith('restored-admin-token');
    expect(clearAdminSessionToken).toHaveBeenCalledOnce();
    expect(setAuthTokenAndPersist.mock.invocationCallOrder[0]).toBeLessThan(
      clearAdminSessionToken.mock.invocationCallOrder[0]
    );
    expect(clearAdminSessionToken.mock.invocationCallOrder[0]).toBeLessThan(
      returnToAdminPanel.mock.invocationCallOrder[0]
    );
  });

  it('prevents duplicate return requests while the first request is pending', async () => {
    const user = userEvent.setup();
    let resolvePost: (result: { token?: string }) => void = () => {};
    post.mockImplementation(
      () =>
        new Promise<{ token?: string }>((resolve) => {
          resolvePost = resolve;
        })
    );
    renderWithProviders(<ImpersonationBanner />);

    await user.click(
      screen.getByRole('button', {
        name: 'Open return to admin panel controls',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Back to admin panel' })
    );

    const pendingAction = screen.getByRole('button', {
      name: 'Returning to admin panel',
    });
    expect(pendingAction).toBeDisabled();
    expect(post).toHaveBeenCalledOnce();

    resolvePost({});
    await waitFor(() => expect(returnToAdminPanel).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledOnce();
  });

  it('keeps the control usable and reports an error when returning fails', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('network unavailable'));
    renderWithProviders(<ImpersonationBanner />);

    await user.click(
      screen.getByRole('button', {
        name: 'Open return to admin panel controls',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Back to admin panel' })
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not return to the admin panel. Please try again.'
      )
    );
    expect(
      screen.getByRole('button', { name: 'Back to admin panel' })
    ).toBeEnabled();
    expect(clearAdminSessionToken).not.toHaveBeenCalled();
    expect(returnToAdminPanel).not.toHaveBeenCalled();
  });
});
