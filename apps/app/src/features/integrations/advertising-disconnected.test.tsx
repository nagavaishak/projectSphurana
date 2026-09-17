import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * Advertising layout — disconnected empty-state, ported from the ads-disconnected
 * E2E (bare org, no Meta connection). With no connection the layout must render
 * the "Connect Meta Ads" CTA in place of the campaign list, expose the Learn-More
 * link, and NOT mount the campaign table / a create-campaign CTA (the layout
 * short-circuits before <Outlet/>). We mock the two integration hooks the layout
 * gates on, and render the route's component directly.
 */

const useGetMetaIntegration = vi.fn();
const initiateAuth = vi.fn();

vi.mock('@/features/integrations', () => ({
  useGetMetaIntegration: () => useGetMetaIntegration(),
  useInitiateMetaAdsAuth: () => ({ initiateAuth }),
}));

// The connected branch renders <Outlet/>; stub it so the router isn't needed.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Outlet: () => <div data-testid="campaign-outlet">campaign list</div>,
  };
});

import { Route } from '@/routes/_authed/dashboard/l/$locationId/marketing/advertising';

const AdvertisingLayout = Route.options.component as () => JSX.Element;

describe('Advertising layout — disconnected', () => {
  it('shows the Connect Meta Ads CTA in place of the campaign list', () => {
    useGetMetaIntegration.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });

    renderWithProviders(<AdvertisingLayout />);

    expect(
      document.querySelector('[data-slot="empty-title"]')
    ).toHaveTextContent('Connect Meta Ads');
    expect(
      document.querySelector('[data-slot="empty-description"]')
    ).toHaveTextContent(/manage your advertising campaigns/i);
    expect(
      screen.getByRole('button', { name: 'Connect Meta Ads' })
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: /learn more about meta ads/i })
    ).toBeVisible();
  });

  it('does not render the campaign table/outlet or a create-campaign CTA', () => {
    useGetMetaIntegration.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });

    renderWithProviders(<AdvertisingLayout />);

    // Layout short-circuits before <Outlet/> — the campaign list never mounts.
    expect(screen.queryByTestId('campaign-outlet')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /^campaigns$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /create.*ad|new.*ad|new.*campaign|create.*campaign/i,
      })
    ).not.toBeInTheDocument();
  });

  it('fires the Meta OAuth flow when the CTA is clicked', async () => {
    useGetMetaIntegration.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });
    const user = userEvent.setup();

    renderWithProviders(<AdvertisingLayout />);
    await user.click(screen.getByRole('button', { name: 'Connect Meta Ads' }));

    expect(initiateAuth).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the integration query is in flight', () => {
    useGetMetaIntegration.mockReturnValue({
      isConnected: false,
      isLoading: true,
    });

    renderWithProviders(<AdvertisingLayout />);

    // The empty CTA only renders once the query resolves.
    expect(
      screen.queryByRole('button', { name: 'Connect Meta Ads' })
    ).not.toBeInTheDocument();
  });

  it('renders the campaign list (Outlet) once connected', () => {
    useGetMetaIntegration.mockReturnValue({
      isConnected: true,
      isLoading: false,
    });

    renderWithProviders(<AdvertisingLayout />);

    expect(screen.getByTestId('campaign-outlet')).toBeVisible();
    expect(screen.queryByText('Connect Meta Ads')).not.toBeInTheDocument();
  });
});
