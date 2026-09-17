import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const setLocation = vi.fn();
const activeLocation = {
  location: { id: 'loc-1', name: 'Dublin Clinic', addressLine1: '1 Test St' },
  locations: [
    { id: 'loc-1', name: 'Dublin Clinic', addressLine1: '1 Test St' },
    { id: 'loc-2', name: 'Cork Branch', addressLine1: '12 Oliver Plunkett St' },
  ],
  setLocation,
  isLoading: false,
  isMultiLocation: true,
};
const branchAccess = {
  isRestricted: false,
  allowedLocationIds: [] as string[],
  isAdmin: false,
  roleKnown: true,
  isLoading: false,
};

vi.mock('@/features/organization-locations', () => ({
  useActiveLocation: () => activeLocation,
  useBranchAccess: () => branchAccess,
}));

vi.mock('@tanstack/react-router', () => ({
  // Spreads `rest`: the menu renders its items `asChild`, so the `role` and
  // the handlers Radix merges onto the Link land on this anchor. A mock that
  // drops them renders a link with no menuitem role, and every query for one
  // fails for a reason that has nothing to do with the component.
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: {
    children: React.ReactNode;
    to?: string;
    params?: unknown;
  }) => (
    <a href="/" {...rest}>
      {children}
    </a>
  ),
}));

import { SidebarProvider } from '@/components/ui/sidebar';

import { LocationSwitcher } from './location-switcher';

/** The switcher lives in the sidebar rail and reads its context. */
const inSidebar = () => (
  <SidebarProvider>
    <LocationSwitcher />
  </SidebarProvider>
);

const LOCKED_COPY = 'Contact your manager to be added to this location';

describe('LocationSwitcher branch access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    branchAccess.isRestricted = false;
    branchAccess.allowedLocationIds = [];
    branchAccess.isAdmin = false;
    branchAccess.roleKnown = true;
  });

  it('lets an unrestricted user switch to any branch', async () => {
    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Cork/ }));

    expect(setLocation).toHaveBeenCalledWith('loc-2');
    expect(screen.queryByText(LOCKED_COPY)).not.toBeInTheDocument();
  });

  it('shows a branch the practitioner does not work at, greyed, with the way out', async () => {
    branchAccess.isRestricted = true;
    branchAccess.allowedLocationIds = ['loc-1'];

    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));

    // VISIBLE — knowing the branch exists is the point of not hiding it.
    const cork = await screen.findByRole('menuitem', { name: /Cork/ });
    expect(cork).toBeInTheDocument();
    expect(screen.getByText(LOCKED_COPY)).toBeInTheDocument();

    // …but not openable, and clicking it changes nothing.
    expect(cork).toHaveAttribute('aria-disabled', 'true');
    await user.click(cork);
    expect(setLocation).not.toHaveBeenCalled();
  });

  it('hides branch administration from a non-admin', async () => {
    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));

    // Both destinations are admin-gated on the API — offering them here is
    // offering a door that 403s.
    expect(
      screen.queryByRole('menuitem', { name: /edit this location/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /manage locations/i })
    ).not.toBeInTheDocument();
  });

  it('shows branch administration to an admin', async () => {
    branchAccess.isAdmin = true;

    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));

    expect(
      await screen.findByRole('menuitem', { name: /edit this location/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /manage locations/i })
    ).toBeInTheDocument();
  });

  it('keeps branch administration visible when the role cannot be read', async () => {
    // A 403 mid org-switch, or any blip on the members request, leaves the role
    // unreadable. Hiding the controls then would strand a real admin — on an
    // org with no branches, it removes the only route to adding one.
    branchAccess.roleKnown = false;
    branchAccess.isAdmin = false;

    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));

    expect(
      await screen.findByRole('menuitem', { name: /manage locations/i })
    ).toBeInTheDocument();
  });

  it('still lets them switch to a branch they DO work at', async () => {
    branchAccess.isRestricted = true;
    branchAccess.allowedLocationIds = ['loc-1', 'loc-2'];

    const user = userEvent.setup();
    renderWithProviders(inSidebar());

    await user.click(screen.getByRole('button', { name: /change location/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Cork/ }));

    expect(setLocation).toHaveBeenCalledWith('loc-2');
  });
});
