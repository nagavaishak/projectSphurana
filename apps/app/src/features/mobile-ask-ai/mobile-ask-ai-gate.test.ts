import { describe, expect, it } from 'vitest';

import {
  isAssistantPath,
  isDashboardShellPath,
  shouldShowMobileAskAiDock,
} from './mobile-ask-ai-gate';

describe('isAssistantPath', () => {
  it('is true for /assistant and descendants', () => {
    expect(isAssistantPath('/assistant')).toBe(true);
    expect(isAssistantPath('/assistant/')).toBe(true);
    expect(isAssistantPath('/assistant/thread')).toBe(true);
  });

  it('is false elsewhere', () => {
    expect(isAssistantPath('/dashboard')).toBe(false);
    expect(isAssistantPath('/')).toBe(false);
  });
});

describe('isDashboardShellPath', () => {
  it('is true for /dashboard and descendants', () => {
    expect(isDashboardShellPath('/dashboard')).toBe(true);
    expect(isDashboardShellPath('/dashboard/')).toBe(true);
    expect(isDashboardShellPath('/dashboard/home')).toBe(true);
  });

  it('is false for bare _authed product routes', () => {
    expect(isDashboardShellPath('/assistant')).toBe(false);
    expect(isDashboardShellPath('/billing')).toBe(false);
    expect(isDashboardShellPath('/create-video/x')).toBe(false);
    expect(isDashboardShellPath('/settings/notifications')).toBe(false);
  });
});

describe('shouldShowMobileAskAiDock', () => {
  it('requires mobile viewport and /dashboard shell route', () => {
    expect(shouldShowMobileAskAiDock(false, '/dashboard/home')).toBe(false);
    expect(shouldShowMobileAskAiDock(true, '/assistant')).toBe(false);
    expect(shouldShowMobileAskAiDock(true, '/billing')).toBe(false);
    expect(shouldShowMobileAskAiDock(true, '/dashboard/home')).toBe(true);
    expect(shouldShowMobileAskAiDock(true, '/dashboard')).toBe(true);
  });
});
