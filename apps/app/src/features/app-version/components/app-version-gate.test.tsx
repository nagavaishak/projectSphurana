import { renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppVersionCheck } from '../types';

const useCheckAppVersion = vi.fn();

vi.mock('../api/check-app-version', () => ({
  useCheckAppVersion: () => useCheckAppVersion(),
}));

const { AppVersionGate } = await import('./app-version-gate');

const check = (overrides: Partial<AppVersionCheck>): AppVersionCheck => ({
  status: 'ok',
  currentVersion: '1.0.4',
  minimumVersion: null,
  latestVersion: null,
  storeUrl: 'https://apps.apple.com/app/id6759301177',
  ...overrides,
});

describe('AppVersionGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks the app when an update is required', () => {
    useCheckAppVersion.mockReturnValue({
      check: check({ status: 'update_required', minimumVersion: '1.1.0' }),
      isLoading: false,
    });

    renderWithProviders(
      <AppVersionGate>
        <p>app content</p>
      </AppVersionGate>
    );

    expect(screen.getByText('Update required')).toBeVisible();
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
  });

  // The three branches below are the whole safety argument for shipping a
  // remote kill-switch: every unknown must resolve to "let them in". A
  // false block cannot be undone by an OTA bundle — only by the App Store.
  it('renders the app on web, where there is no version to check', () => {
    useCheckAppVersion.mockReturnValue({ check: null, isLoading: false });

    renderWithProviders(
      <AppVersionGate>
        <p>app content</p>
      </AppVersionGate>
    );

    expect(screen.getByText('app content')).toBeVisible();
  });

  it('renders the app while the check is still loading', () => {
    useCheckAppVersion.mockReturnValue({ check: null, isLoading: true });

    renderWithProviders(
      <AppVersionGate>
        <p>app content</p>
      </AppVersionGate>
    );

    expect(screen.getByText('app content')).toBeVisible();
  });

  it('renders the app when only a nudge is warranted', () => {
    useCheckAppVersion.mockReturnValue({
      check: check({ status: 'update_available', latestVersion: '1.2.0' }),
      isLoading: false,
    });

    renderWithProviders(
      <AppVersionGate>
        <p>app content</p>
      </AppVersionGate>
    );

    expect(screen.getByText('app content')).toBeVisible();
    expect(screen.queryByText('Update required')).not.toBeInTheDocument();
  });
});
