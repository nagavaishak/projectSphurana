import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ImportFromLocationDialog } from './import-from-location-dialog';
import type { ImportFromLocationDialogProps } from './import-from-location-types';

/**
 * The agnostic import shell.
 *
 * The properties worth defending: a record already at the target CANNOT be
 * imported twice, and a selection never survives a change of source branch —
 * both of which end in duplicate rows in a customer's catalogue.
 */

const ROWS = [
  { id: 'a', name: 'Prenatal Massage', meta: '60 min', trailing: '€90' },
  { id: 'b', name: 'Lymphatic Drainage', meta: '45 min', trailing: '€75' },
  {
    id: 'c',
    name: 'Deep Tissue Massage',
    meta: '60 min',
    trailing: '€85',
    alreadyHere: true,
  },
];

const props = (
  overrides: Partial<ImportFromLocationDialogProps> = {}
): ImportFromLocationDialogProps => ({
  open: true,
  onOpenChange: vi.fn(),
  title: 'Import services',
  entityPlural: 'services',
  targetLocationName: "53 St Fintan's Crescent",
  sourceLocations: [
    { id: 'rathmines', name: 'Rathmines Clinic' },
    { id: 'sandyford', name: 'Sandyford Studio' },
  ],
  sourceLocationId: 'rathmines',
  onSourceLocationChange: vi.fn(),
  rows: ROWS,
  onImport: vi.fn(),
  ...overrides,
});

describe('ImportFromLocationDialog', () => {
  it('says where the copies land and that they diverge', () => {
    renderWithProviders(<ImportFromLocationDialog {...props()} />);

    expect(
      screen.getByText(
        "Copies land in 53 St Fintan's Crescent. Edits afterwards are independent."
      )
    ).toBeInTheDocument();
  });

  it('imports exactly what was ticked', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    renderWithProviders(<ImportFromLocationDialog {...props({ onImport })} />);

    await user.click(
      screen.getByRole('checkbox', { name: /prenatal massage/i })
    );
    await user.click(screen.getByRole('button', { name: 'Import 1' }));

    expect(onImport).toHaveBeenCalledWith(['a']);
  });

  it('will not import a record the target already has', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    renderWithProviders(<ImportFromLocationDialog {...props({ onImport })} />);

    const already = screen.getByRole('checkbox', {
      name: /deep tissue massage/i,
    });
    expect(already).toBeDisabled();
    expect(screen.getByText('Already here')).toBeInTheDocument();

    // "Select all" is the other way a disabled row could sneak in.
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Import 2' }));

    expect(onImport).toHaveBeenCalledWith(['a', 'b']);
  });

  it('counts only what can still be copied', () => {
    renderWithProviders(<ImportFromLocationDialog {...props()} />);

    // Three rows, one already here — the source offers TWO.
    expect(screen.getByText('2 services')).toBeInTheDocument();
  });

  it('drops the selection when the source branch changes', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const { rerender } = renderWithProviders(
      <ImportFromLocationDialog {...props({ onImport })} />
    );

    await user.click(
      screen.getByRole('checkbox', { name: /prenatal massage/i })
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerender(
      <ImportFromLocationDialog
        {...props({
          onImport,
          sourceLocationId: 'sandyford',
          rows: [{ id: 'z', name: 'Hot Stone', meta: '75 min' }],
        })}
      />
    );

    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('drops the selection when the dialog is closed and reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <ImportFromLocationDialog {...props()} />
    );

    await user.click(
      screen.getByRole('checkbox', { name: /prenatal massage/i })
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // The dialog stays MOUNTED while closed — without a reset the next visit
    // reopens holding ticks the user cannot see they still have.
    rerender(<ImportFromLocationDialog {...props({ open: false })} />);
    rerender(<ImportFromLocationDialog {...props()} />);

    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('says "1 service", not "1 services"', () => {
    renderWithProviders(
      <ImportFromLocationDialog
        {...props({
          rows: [{ id: 'a', name: 'Prenatal Massage', meta: '60 min' }],
        })}
      />
    );

    expect(screen.getByText('1 service')).toBeInTheDocument();
  });

  it('offers a retry when the source list fails to load', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(
      <ImportFromLocationDialog
        {...props({ isError: true, onRetry, rows: [] })}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not load the services at that location.'
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
