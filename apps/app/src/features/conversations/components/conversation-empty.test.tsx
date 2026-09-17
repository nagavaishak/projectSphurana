import { renderWithProviders, screen } from '@/test/render';
import { describe, expect, it } from 'vitest';

import { ConversationEmpty } from './conversation-empty';

// Desktop inbox no-selection placeholder (inbox.spec.ts, desktop branch).
describe('ConversationEmpty', () => {
  it('renders the "select a conversation" placeholder', () => {
    renderWithProviders(<ConversationEmpty />);

    expect(screen.getByText('Select a conversation')).toBeVisible();
    expect(
      screen.getByText(/choose a conversation from the list/i)
    ).toBeVisible();
  });
});
