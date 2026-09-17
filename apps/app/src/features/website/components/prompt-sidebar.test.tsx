import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TranscriptEntry } from '../api/types';
import { PromptSidebar } from './prompt-sidebar';

function render(entries: TranscriptEntry[], overrides = {}) {
  const props = {
    entries,
    isStreaming: false,
    selectionLabel: null,
    onClearSelection: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onUndo: vi.fn(),
    onKeep: vi.fn(),
    ...overrides,
  };
  return { ...renderWithProviders(<PromptSidebar {...props} />), props };
}

describe('PromptSidebar', () => {
  it('offers quick actions on a cold start', async () => {
    const { props } = render([]);
    await userEvent.click(
      screen.getByRole('button', { name: /add an about page/i })
    );
    expect(props.onSend).toHaveBeenCalledWith('Add an about page');
  });

  it('renders tool calls as activity lines, never raw arguments', () => {
    render([
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        status: 'streaming',
        activities: [
          {
            id: 't1',
            name: 'add_block',
            summary: 'Added a testimonials section',
            requiresConfirmation: false,
          },
        ],
      },
    ]);

    expect(
      screen.getByText('Added a testimonials section')
    ).toBeInTheDocument();
    expect(screen.queryByText(/add_block/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('shows a guardrail refusal as a refusal, and says the draft is untouched', () => {
    render([
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        status: 'refused',
        activities: [],
        error: {
          message: 'That turn needed more than 25 steps.',
          code: 'tool_limit',
        },
      },
    ]);

    expect(
      screen.getByText('That was too big for one turn')
    ).toBeInTheDocument();
    expect(screen.getByText(/your draft was not changed/i)).toBeInTheDocument();
    // A refusal is a status, not a crash — it must not be announced as an alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the monthly spend cap rather than looking like a bug', () => {
    render([
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        status: 'refused',
        activities: [],
        error: { message: 'Monthly AI budget reached.', code: 'spend_cap' },
      },
    ]);
    expect(
      screen.getByText('AI editing is paused for this month')
    ).toBeInTheDocument();
  });

  it('surfaces a transport failure as an alert, never silently', () => {
    render([
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        status: 'error',
        activities: [],
        error: { message: 'The connection dropped.' },
      },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /that turn did not finish/i
    );
  });

  it('scopes the next prompt to the selected block', () => {
    render([], { selectionLabel: 'Hero' });
    expect(screen.getByText('Editing: Hero')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Change the Hero section…')
    ).toBeInTheDocument();
  });

  it('keeps the transcript in a live region so streaming is announced', () => {
    render([]);
    const region = screen.getByLabelText('Conversation transcript');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});
