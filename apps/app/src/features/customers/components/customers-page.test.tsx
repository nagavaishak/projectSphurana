import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listLeadsMock } = vi.hoisted(() => ({
  listLeadsMock: vi.fn(),
}));

vi.mock('@/components/app/list-page', async () => {
  const actual = await vi.importActual<
    typeof import('@/components/app/list-page')
  >('@/components/app/list-page');

  return {
    ...actual,
    ListPage: ({
      config,
    }: {
      config: { title: string; footer?: ReactNode };
    }) => (
      <main>
        <h1>{config.title}</h1>
        {config.footer}
      </main>
    ),
  };
});

vi.mock('@/features/document-imports', () => ({
  ImportDocumentsDialog: () => null,
}));

vi.mock('@/features/leads', () => ({
  ImportLeadsCsvDialog: () => null,
  useDeleteLead: () => ({ deleteLead: vi.fn(), isDeleting: false }),
  useListLeads: (options: unknown) => listLeadsMock(options),
}));

vi.mock('@/lib/use-routes', () => ({
  useResolvedRoutes: () => ({
    customerDetail: (id: string) => `/customers/${id}`,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../api', () => ({
  useLeadStageCounts: () => ({ counts: undefined }),
}));

import { CustomersPage } from './customers-page';

describe('CustomersPage pagination', () => {
  beforeEach(() => {
    listLeadsMock.mockReturnValue({
      leads: [],
      total: 129,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('requests fixed-size server pages and resets when the stage tab changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CustomersPage onTabChange={vi.fn()} tab="leads" />
    );

    expect(screen.getByText('Showing 1–25 of 129 clients')).toBeVisible();
    expect(screen.getByText('Page 1 of 6')).toBeVisible();
    expect(listLeadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ limit: 25, offset: 0 }),
      })
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(listLeadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ limit: 25, offset: 25 }),
        })
      );
    });
    expect(screen.getByText('Showing 26–50 of 129 clients')).toBeVisible();
    expect(screen.getByText('Page 2 of 6')).toBeVisible();

    rerender(<CustomersPage onTabChange={vi.fn()} tab="booked" />);

    await waitFor(() => {
      expect(listLeadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            stageGroup: 'booked',
            limit: 25,
            offset: 0,
          }),
        })
      );
    });
    expect(screen.getByText('Page 1 of 6')).toBeVisible();
  });
});
