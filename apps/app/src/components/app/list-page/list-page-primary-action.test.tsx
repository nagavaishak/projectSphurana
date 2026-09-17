import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlusIcon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ListPage } from './list-page';
import type { ListPageConfig } from './list-page-types';

/**
 * The split create button.
 *
 * The property under test is that the caret NEVER replaces the primary action:
 * a page with a second way to create (import from another branch) must still
 * create from scratch in one click, on the header AND on the empty state.
 */

type Row = { id: string; name: string };

const baseConfig = (
  primaryAction: ListPageConfig<Row>['primaryAction'],
  rows: Row[] = [{ id: '1', name: 'Deep Tissue Massage' }]
): ListPageConfig<Row> => ({
  title: 'Services',
  columns: [{ key: 'name', header: 'Name', cell: (row) => row.name }],
  rows,
  rowKey: (row) => row.id,
  primaryAction,
  empty: { icon: PlusIcon, title: 'No services yet' },
});

describe('ListPage primary action', () => {
  it('renders a plain button when there is no menu', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <ListPage config={baseConfig({ label: 'Add service', onClick })} />
    );

    expect(
      screen.queryByRole('button', { name: /more add service options/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the primary action one click away beside the caret', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onImport = vi.fn();

    renderWithProviders(
      <ListPage
        config={baseConfig({
          label: 'Add service',
          onClick,
          menu: {
            items: [
              { label: 'New service', onSelect: onClick },
              { label: 'Import from another location…', onSelect: onImport },
            ],
            footer: '4 other locations available to copy from',
          },
        })}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add service' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('offers the alternatives behind the caret', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();

    renderWithProviders(
      <ListPage
        config={baseConfig({
          label: 'Add service',
          onClick: vi.fn(),
          menu: {
            items: [
              { label: 'New service', onSelect: vi.fn() },
              { label: 'Import from another location…', onSelect: onImport },
            ],
            footer: '4 other locations available to copy from',
          },
        })}
      />
    );

    await user.click(
      screen.getByRole('button', { name: /more add service options/i })
    );
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'Import from another location…',
      })
    );

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('4 other locations available to copy from')
    ).not.toBeInTheDocument();
  });

  it('offers the same caret on the empty state', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ListPage
        config={baseConfig(
          {
            label: 'Add service',
            onClick: vi.fn(),
            menu: {
              items: [{ label: 'New service', onSelect: vi.fn() }],
            },
          },
          []
        )}
      />
    );

    // Two split buttons now: the header's and the empty state's.
    await user.click(screen.getByText('No services yet'));
    expect(
      screen.getAllByRole('button', { name: /more add service options/i })
    ).toHaveLength(2);
  });
});
