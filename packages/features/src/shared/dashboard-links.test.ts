import { describe, expect, it } from 'vitest';

import { conversationInboxPath, conversationInboxUrl } from './dashboard-links';

/**
 * The SHAPE half of the contract. The RESOLUTION half — whether the shape opens
 * a page — lives in `apps/app-e2e/src/navigation/email-deep-links.spec.ts`,
 * because only a browser pointed at the app can answer that.
 *
 * Keeping both matters. The test this replaces asserted:
 *
 *     expect(props.dashboardUrl).toBe(`${APP_URL}/dashboard/conversations/${id}`)
 *
 * — the string the service built, compared against the same string the service
 * built. It passed for months while every escalation email pointed at a 404.
 * So nothing here re-states a template; each assertion names the PROPERTY that
 * has to hold, and the one that actually broke gets its own test.
 */
describe('conversationInboxPath', () => {
  it('puts the conversation id in the SEARCH string, not a path segment', () => {
    // THE REGRESSION. `dashboard/conversations.tsx` validates `?id=` and
    // forwards it to the branch-scoped inbox; a path segment matches no route
    // at all and dead-ends in the splat.
    const path = conversationInboxPath('conv-1');

    expect(new URL(path, 'https://app.borradh.io').searchParams.get('id')).toBe(
      'conv-1'
    );
    expect(path).not.toMatch(/\/conversations\/conv-1/);
  });

  it('stays un-prefixed so the client can resolve the branch', () => {
    // A conversation has no `location_id`, so the server has no branch to name.
    // Emitting `/dashboard/l/<something>/…` here would mean guessing one.
    expect(conversationInboxPath('conv-1')).toMatch(/^\/dashboard\//);
    expect(conversationInboxPath('conv-1')).not.toMatch(/^\/dashboard\/l\//);
  });

  it('encodes ids that would otherwise break the query string', () => {
    const path = conversationInboxPath('a&b=c d');

    expect(path).not.toContain('a&b=c d');
    expect(new URL(path, 'https://app.borradh.io').searchParams.get('id')).toBe(
      'a&b=c d'
    );
  });
});

describe('conversationInboxUrl', () => {
  it('produces an absolute url on the caller-supplied origin', () => {
    const url = new URL(
      conversationInboxUrl('https://app.borradh.io', 'conv-1')
    );

    expect(url.origin).toBe('https://app.borradh.io');
    expect(url.pathname).toBe('/dashboard/conversations');
    expect(url.searchParams.get('id')).toBe('conv-1');
  });

  it('does not double the slash when the base url carries a trailing one', () => {
    // `APP_URL ?? WEB_URL` is env-supplied and has arrived both ways.
    expect(conversationInboxUrl('https://app.borradh.io/', 'conv-1')).toBe(
      conversationInboxUrl('https://app.borradh.io', 'conv-1')
    );
  });
});
