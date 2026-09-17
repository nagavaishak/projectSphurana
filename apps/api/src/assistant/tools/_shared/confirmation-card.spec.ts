import { confirmationCard } from './confirmation-card.js';

/**
 * ONE SHAPE, for every confirmation.
 *
 * This envelope is the whole reason the confirmation cards render at all. The
 * hand-rolled confirm/execute pairs issued their own tokens and returned them
 * as bare data, so the frontend had to recognise each tool by NAME — and every
 * one of those bespoke cards was written for a tool that PAUSED awaiting a
 * browser answer. None of them do: they execute on the server and stream an
 * object, so each card compared an object to the string 'approved' and rendered
 * a red CANCELLED badge over an action nobody had cancelled, with no way left
 * to approve it.
 */
describe('confirmationCard', () => {
  const base = {
    action: 'launch_ad' as const,
    resourceId: 'ad-1',
    token: 'tok-1',
    expiresAt: new Date('2026-01-01T10:00:00.000Z'),
    title: 'Launch "Winter offer"?',
    fields: [{ label: 'Budget', value: '€10/day' }],
    executeToolName: 'meta_ads_executeLaunchAd',
  };

  it('is the same envelope the factory emits', () => {
    const card = confirmationCard(base);

    expect(card.type).toBe('confirmation_required');
    expect(card.action).toBe('launch_ad');
    expect(card.resourceId).toBe('ad-1');
    expect(card.token).toBe('tok-1');
    expect(card.executeToolName).toBe('meta_ads_executeLaunchAd');
  });

  // The card never calls the tool back — it sends the owner's answer as a
  // message, and the MODEL holds the token for the second call. Losing it here
  // would leave a confirmation that can be agreed to and never acted on.
  it('carries the token and its expiry as a string', () => {
    const card = confirmationCard(base);

    expect(card.token).toBe('tok-1');
    expect(card.expiresAt).toBe('2026-01-01T10:00:00.000Z');
  });

  it('accepts an already-serialised expiry unchanged', () => {
    const card = confirmationCard({
      ...base,
      expiresAt: '2026-02-02T09:00:00.000Z',
    });

    expect(card.expiresAt).toBe('2026-02-02T09:00:00.000Z');
  });

  // What the owner is agreeing to. Money and reach belong here, because this is
  // the last thing they read before spending.
  it('carries the summary the owner reads', () => {
    const card = confirmationCard(base);

    expect(card.summary).toEqual({
      title: 'Launch "Winter offer"?',
      fields: [{ label: 'Budget', value: '€10/day' }],
    });
  });

  // A button that says "Confirm" makes them re-read the card to find out what
  // they are confirming.
  it('names the verb when one is given', () => {
    expect(
      confirmationCard({ ...base, confirmLabel: 'Launch' }).confirmLabel
    ).toBe('Launch');
  });

  it('omits the verb entirely rather than inventing one', () => {
    expect('confirmLabel' in confirmationCard(base)).toBe(false);
  });
});
