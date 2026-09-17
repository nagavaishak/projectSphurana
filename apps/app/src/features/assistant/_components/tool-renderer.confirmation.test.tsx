import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isToolPartVisible } from './tool-parts';
import { ToolRenderer } from './tool-renderer';

/**
 * Confirmations, as they actually arrive.
 *
 * THE BUG THIS PINS. Every `confirm*` tool executes on the SERVER and streams
 * `tool-output-available` with an OBJECT — the token, the summary fields, the
 * ad name. The confirmation cards were written for a different world, one where
 * the tool paused at `input-available` and the browser supplied the answer via
 * `addToolOutput({ output: 'approved' | 'rejected' })`. So they all did this:
 *
 *     if (state === 'output-available') {
 *       const approved = output === 'approved';   // an object, so: false
 *       return <Badge variant="destructive">Cancelled</Badge>;
 *     }
 *
 * Which means every confirmation in Claire — launching an ad, changing a
 * budget, escalating a conversation, rendering a video — rendered a red
 * CANCELLED badge over an action nobody had cancelled, with no way to approve
 * it. The owner sees a refusal; the model sees a token it is waiting to have
 * echoed back. Both are stuck, and neither can tell.
 *
 * The fix is the factory envelope: the tool says `confirmation_required` and
 * the card asks the question. These tests assert the ASK, because that is the
 * thing that was missing.
 */
/**
 * Visibility is decided BEFORE the renderer runs, by `isToolPartVisible`, and it
 * used to be decided by a tool-name list. `executeLaunchAd` was not on it, so it
 * emitted a perfectly good confirmation envelope and was hidden — and Claire
 * said "confirm on the card above" over nothing, for the second time. A card
 * now answers for itself.
 */
describe('tool visibility — a card answers for itself', () => {
  it('shows any tool that names a card, listed or not', () => {
    expect(
      isToolPartVisible(
        {
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: { presentation: { type: 'confirmation_required' } },
        } as never,
        true
      )
    ).toBe(true);
  });

  it('hides a tool that says it has nothing to show', () => {
    expect(
      isToolPartVisible(
        {
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: { presentation: { type: 'none' } },
        } as never,
        true
      )
    ).toBe(false);
  });
});

describe('ToolRenderer — confirmations', () => {
  const confirmationOutput = {
    presentation: {
      type: 'confirmation_required',
      action: 'launch_ad',
      resourceId: 'ad-1',
      token: 'tok-1',
      summary: {
        title: 'Launch this ad?',
        fields: [
          { label: 'Campaign', value: 'Winter lip filler' },
          { label: 'Budget', value: '€10/day' },
        ],
      },
      executeToolName: 'meta_ads_launchAd',
    },
  };

  it('asks the question rather than reporting a refusal', () => {
    render(
      <ToolRenderer
        toolName="confirmLaunchAd"
        toolPart={{
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: confirmationOutput,
        }}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByText('Launch this ad?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    // The word that used to be the entire card.
    expect(screen.queryByText(/^Cancelled$/)).not.toBeInTheDocument();
  });

  it('shows what is being agreed to', () => {
    render(
      <ToolRenderer
        toolName="confirmLaunchAd"
        toolPart={{
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: confirmationOutput,
        }}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByText('Winter lip filler')).toBeInTheDocument();
    expect(screen.getByText('€10/day')).toBeInTheDocument();
  });

  it('answers by SENDING A MESSAGE — the model holds the token, not the card', async () => {
    const onSendMessage = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    render(
      <ToolRenderer
        toolName="confirmLaunchAd"
        toolPart={{
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: confirmationOutput,
        }}
        onSendMessage={onSendMessage}
      />
    );

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0]).toMatch(/yes/i);
  });

  it('stays spent once answered — a control that vanishes takes the only acknowledgement with it', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    render(
      <ToolRenderer
        toolName="confirmLaunchAd"
        toolPart={{
          state: 'output-available',
          toolCallId: 'call-1',
          input: {},
          output: confirmationOutput,
        }}
        onSendMessage={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /confirm/i })
    ).not.toBeInTheDocument();
  });
});
