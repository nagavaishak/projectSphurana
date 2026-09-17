import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '@/test/render';
import { QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
}));

import { useBranchAccess } from './use-branch-access';

/**
 * Who the switcher greys branches for.
 *
 * Every case here is a way to get this WRONG in production: restricting the
 * admin locks the only person who can fix an assignment out of fixing it, and
 * reading "no rows" as "nowhere" empties the switcher for every org that has
 * never assigned anyone — which today is all of them.
 */

const ME = { id: 'user-1', email: 'aoife@example.com' };

function route({
  role,
  practitioner,
}: {
  role: string;
  practitioner?: { userId: string; locations?: { locationId: string }[] };
}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('auth/session'))
      return Promise.resolve({ user: ME, session: {} });
    if (url.startsWith('organizations') && url.endsWith('members'))
      return Promise.resolve([{ id: 'm1', userId: ME.id, role, user: ME }]);
    if (url.startsWith('organization/active') || url.includes('active'))
      return Promise.resolve({ id: 'org-1', name: 'Test' });
    if (url.startsWith('practitioners'))
      return Promise.resolve({
        items: practitioner ? [{ id: 'p1', ...practitioner }] : [],
        limit: 50,
        offset: 0,
      });
    return Promise.resolve({});
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    {children}
  </QueryClientProvider>
);

describe('useBranchAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restricts a practitioner to the branches they work at', async () => {
    route({
      role: 'member',
      practitioner: { userId: ME.id, locations: [{ locationId: 'loc-1' }] },
    });

    const { result } = renderHook(() => useBranchAccess(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRestricted).toBe(true);
    expect(result.current.allowedLocationIds).toEqual(['loc-1']);
  });

  it('never restricts an admin — they are who you contact', async () => {
    route({
      role: 'admin',
      practitioner: { userId: ME.id, locations: [{ locationId: 'loc-1' }] },
    });

    const { result } = renderHook(() => useBranchAccess(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRestricted).toBe(false);
  });

  it('does not restrict a practitioner with NO branch rows (works everywhere)', async () => {
    // The empty-junction convention. Reading this as "nowhere" would empty the
    // switcher for every org that has never assigned anyone.
    route({
      role: 'member',
      practitioner: { userId: ME.id, locations: [] },
    });

    const { result } = renderHook(() => useBranchAccess(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRestricted).toBe(false);
  });

  it('does not restrict a member who is not a practitioner at all', async () => {
    // A receptionist has no "works at" to read.
    route({ role: 'member' });

    const { result } = renderHook(() => useBranchAccess(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRestricted).toBe(false);
  });
});
