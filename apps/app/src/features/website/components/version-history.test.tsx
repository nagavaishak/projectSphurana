import { renderWithProviders, screen } from '@/test/render';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MicrositeRevisionSummary } from '../api/types';
import { VersionHistory } from './version-history';

const revisions: MicrositeRevisionSummary[] = [
  {
    id: 'rev_3',
    label: 'Added a testimonials section',
    createdBy: 'agent',
    promptId: 'p3',
    prompt: 'Add some testimonials',
    createdAt: '2026-08-18T10:00:00.000Z',
    isDraft: true,
  },
  {
    id: 'rev_2',
    label: 'Fixed a typo in the hero',
    createdBy: 'user',
    promptId: null,
    createdAt: '2026-08-17T10:00:00.000Z',
  },
  {
    id: 'rev_1',
    label: 'Initial website',
    createdBy: 'system',
    promptId: null,
    createdAt: '2026-08-16T10:00:00.000Z',
    isPublished: true,
  },
];

function render(overrides = {}) {
  const props = {
    revisions,
    isLoading: false,
    isError: false,
    onRestore: vi.fn(),
    isRestoring: false,
    restoringId: null,
    ...overrides,
  };
  return { ...renderWithProviders(<VersionHistory {...props} />), props };
}

async function openHistory() {
  await userEvent.click(screen.getByRole('button', { name: /history/i }));
}

describe('VersionHistory', () => {
  it('lists each revision with the prompt that caused it', async () => {
    render();
    await openHistory();

    expect(
      screen.getByText('Added a testimonials section')
    ).toBeInTheDocument();
    expect(screen.getByText('“Add some testimonials”')).toBeInTheDocument();
    expect(screen.getByText(/manual edit/i)).toBeInTheDocument();
  });

  it('marks live and draft from the API flags, not list position', async () => {
    render();
    await openHistory();

    const live = screen.getByText('Live').closest('li');
    expect(live).toHaveTextContent('Initial website');

    const draft = screen.getByText('Current draft').closest('li');
    expect(draft).toHaveTextContent('Added a testimonials section');
  });

  it('restores a revision after confirmation', async () => {
    const { props } = render();
    await openHistory();

    const row = screen.getByText('Fixed a typo in the hero').closest('li');
    expect(row).not.toBeNull();
    await userEvent.click(
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      within(row!).getByRole('button', { name: /restore/i })
    );

    expect(props.onRestore).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog', {
      name: /restore this version/i,
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^restore$/i })
    );

    expect(props.onRestore).toHaveBeenCalledWith('rev_2');
  });

  it('cannot restore the revision the draft is already on', async () => {
    render();
    await openHistory();

    const draftRow = screen.getByText('Current draft').closest('li');
    // biome-ignore lint/style/noNonNullAssertion: asserted by the query above
    const button = within(draftRow!).getByRole('button', { name: /restore/i });
    expect(button).toBeDisabled();
  });

  it('reports a history that failed to load', async () => {
    render({ isError: true, revisions: [] });
    await openHistory();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not load your version history/i
    );
  });
});
