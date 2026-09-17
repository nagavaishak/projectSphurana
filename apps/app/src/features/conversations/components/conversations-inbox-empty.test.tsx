import { renderWithProviders, screen } from '@/test/render';
import { describe, expect, it } from 'vitest';

import { ConversationsInboxEmpty } from './conversations-inbox-empty';

// Mobile inbox empty list (inbox.spec.ts, mobile branch) + the filtered variant.
describe('ConversationsInboxEmpty', () => {
  it('renders "No messages yet" for a fresh inbox (mobile)', () => {
    renderWithProviders(
      <ConversationsInboxEmpty variant="mobile" hasActiveFilters={false} />
    );

    expect(screen.getByText('No messages yet')).toBeVisible();
    expect(
      screen.getByText(/when clients message you on instagram/i)
    ).toBeVisible();
  });

  it('renders "No messages yet" for a fresh inbox (sidebar)', () => {
    renderWithProviders(
      <ConversationsInboxEmpty variant="sidebar" hasActiveFilters={false} />
    );

    expect(screen.getByText('No messages yet')).toBeVisible();
  });

  it('switches to a filter-specific empty state with a clear action', () => {
    renderWithProviders(
      <ConversationsInboxEmpty
        variant="sidebar"
        hasActiveFilters
        onClearFilters={() => {}}
      />
    );

    expect(screen.getByText('No matches found')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /clear filters/i })
    ).toBeVisible();
  });
});
