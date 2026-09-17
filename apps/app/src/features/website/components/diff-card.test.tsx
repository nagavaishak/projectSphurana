import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TranscriptEntry } from '../api/types';
import { DiffCard } from './diff-card';

const baseEntry: TranscriptEntry = {
  id: 'a1',
  role: 'assistant',
  text: 'Done.',
  activities: [],
  status: 'complete',
  revisionId: 'rev_2',
  previousRevisionId: 'rev_1',
  diff: { added: 2, edited: 1, removed: 0, themeChanged: false },
};

describe('DiffCard', () => {
  it('renders the server-sent diff and keeps without ceremony', async () => {
    const onKeep = vi.fn();
    renderWithProviders(
      <DiffCard entry={baseEntry} onKeep={onKeep} onUndo={vi.fn()} />
    );

    expect(
      screen.getByText('+2 blocks, ~1 edited, theme unchanged')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^keep$/i }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('undoes without confirmation — undo is the safe direction', async () => {
    const onUndo = vi.fn();
    renderWithProviders(
      <DiffCard entry={baseEntry} onKeep={vi.fn()} onUndo={onUndo} />
    );

    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('will not keep a destructive turn until the user confirms it', async () => {
    const onKeep = vi.fn();
    const entry: TranscriptEntry = {
      ...baseEntry,
      diff: { added: 0, edited: 0, removed: 1, themeChanged: false },
      activities: [
        {
          id: 't1',
          name: 'delete_page',
          summary: 'Deleted the About page',
          requiresConfirmation: true,
        },
      ],
    };

    renderWithProviders(
      <DiffCard entry={entry} onKeep={onKeep} onUndo={vi.fn()} />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /confirm and keep/i })
    );
    // The dialog is open; nothing has been accepted yet.
    expect(onKeep).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: /confirm this change/i })
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /keep the change/i })
    );
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('confirms a destructive turn even when the API omits the flag', () => {
    const entry: TranscriptEntry = {
      ...baseEntry,
      activities: [
        {
          id: 't1',
          name: 'update_theme',
          summary: 'Changed the brand colours',
          // The stream carried no confirmation flag — the sidebar decides.
          requiresConfirmation: true,
        },
      ],
    };

    renderWithProviders(
      <DiffCard entry={entry} onKeep={vi.fn()} onUndo={vi.fn()} />
    );

    expect(
      screen.getByRole('button', { name: /confirm and keep/i })
    ).toBeInTheDocument();
  });

  it('reports a turn that changed nothing instead of showing a bare count', () => {
    renderWithProviders(
      <DiffCard
        entry={{
          ...baseEntry,
          diff: { added: 0, edited: 0, removed: 0, themeChanged: false },
        }}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />
    );
    expect(screen.getByText('Nothing on the site changed')).toBeInTheDocument();
  });

  it('shows the decision once made, not the buttons again', () => {
    renderWithProviders(
      <DiffCard
        entry={{ ...baseEntry, decision: 'undone' }}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />
    );
    expect(screen.getByText('Undone.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /undo/i })
    ).not.toBeInTheDocument();
  });
});

describe('DiffCard — blocking confirmation', () => {
  const blockedEntry: TranscriptEntry = {
    ...baseEntry,
    diff: { added: 0, edited: 0, removed: 0, themeChanged: false },
    pendingConfirmations: [
      {
        action: 'delete_page:pg_pricing',
        prompt: 'Delete the Pricing page?',
      },
    ],
    confirmationState: 'awaiting',
  };

  it('says nothing has happened yet and confirms through the dialog', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <DiffCard
        entry={blockedEntry}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        onConfirm={onConfirm}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByText(/nothing has changed yet/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /confirm and run/i })
    );
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, do it/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('declines without sending anything', async () => {
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    renderWithProviders(
      <DiffCard
        entry={blockedEntry}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('makes a declined turn legible instead of silently ending', () => {
    renderWithProviders(
      <DiffCard
        entry={{ ...blockedEntry, confirmationState: 'declined' }}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />
    );

    expect(screen.getByText(/not done/i)).toBeInTheDocument();
    expect(
      screen.getByText(/nothing on your website changed/i)
    ).toBeInTheDocument();
  });
});
