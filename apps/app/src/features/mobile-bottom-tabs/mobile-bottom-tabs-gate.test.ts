import { describe, expect, it } from 'vitest';

import {
  isMobileBottomTabRoute,
  isMobileFullScreenRoute,
} from './mobile-bottom-tab-routes';
import { shouldShowMobileBottomTabs } from './mobile-bottom-tabs-gate';

describe('isMobileBottomTabRoute', () => {
  it('matches the main tab screens', () => {
    expect(isMobileBottomTabRoute('/dashboard/home')).toBe(true);
    expect(isMobileBottomTabRoute('/dashboard/calendar/day')).toBe(true);
    // Inbox took the tab Socials used to hold: it is the surface people open
    // all day, and it was behind an unlabelled chat bubble in the header.
    expect(isMobileBottomTabRoute('/dashboard/clients/inbox')).toBe(true);
    expect(isMobileBottomTabRoute('/dashboard/more')).toBe(true);
  });

  it('does not match screens that are no longer tabs', () => {
    expect(isMobileBottomTabRoute('/dashboard/marketing/socials')).toBe(false);
    expect(isMobileBottomTabRoute('/dashboard/marketing/advertising')).toBe(
      false
    );
    expect(isMobileBottomTabRoute('/dashboard/sales/list')).toBe(false);
  });
});

describe('isMobileFullScreenRoute', () => {
  it('flags full-screen create flows and the conversation thread', () => {
    expect(isMobileFullScreenRoute('/dashboard/calendar/new')).toBe(true);
    expect(isMobileFullScreenRoute('/dashboard/calendar/new/block')).toBe(true);
    // The unified editor, for any entity — one prefix, not one entry per
    // entity (see MOBILE_FULL_SCREEN_PREFIXES).
    expect(isMobileFullScreenRoute('/create/service')).toBe(true);
    expect(isMobileFullScreenRoute('/create/product')).toBe(true);
    expect(isMobileFullScreenRoute('/edit/service/x')).toBe(true);
    expect(
      isMobileFullScreenRoute('/dashboard/clients/inbox', { id: 'abc' })
    ).toBe(true);
  });

  it('leaves ordinary dashboard screens alone', () => {
    expect(isMobileFullScreenRoute('/dashboard/clients/inbox')).toBe(false);
    expect(isMobileFullScreenRoute('/dashboard/sales/list')).toBe(false);
  });
});

describe('shouldShowMobileBottomTabs', () => {
  it('shows the bar on every dashboard screen, not just tab roots', () => {
    expect(shouldShowMobileBottomTabs(true, '/dashboard/home')).toBe(true);
    expect(shouldShowMobileBottomTabs(true, '/dashboard/sales/list')).toBe(
      true
    );
    expect(shouldShowMobileBottomTabs(true, '/dashboard/team/members')).toBe(
      true
    );
    expect(
      shouldShowMobileBottomTabs(true, '/dashboard/settings/integrations')
    ).toBe(true);
    expect(shouldShowMobileBottomTabs(true, '/dashboard/more/sales')).toBe(
      true
    );
  });

  it('hides the bar off-mobile, off-dashboard, and in full-screen flows', () => {
    expect(shouldShowMobileBottomTabs(false, '/dashboard/home')).toBe(false);
    expect(shouldShowMobileBottomTabs(true, '/assistant')).toBe(false);
    expect(shouldShowMobileBottomTabs(true, '/dashboard/calendar/new')).toBe(
      false
    );
    expect(
      shouldShowMobileBottomTabs(true, '/dashboard/clients/inbox', {
        id: 'thread-1',
      })
    ).toBe(false);
  });
});
