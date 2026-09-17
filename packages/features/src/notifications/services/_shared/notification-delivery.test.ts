import {
  type NotificationPreferencesData,
  withPreferenceDefaults,
} from '@borradh-workspace/labels';
import { describe, expect, it } from '@borradh-workspace/testing';
import { resolveNotificationDelivery } from './notification-delivery.js';

const prefs = (
  overrides: Partial<NotificationPreferencesData> = {}
): NotificationPreferencesData => ({
  appointments: { scope: 'mine', channels: { email: true, push: true } },
  inbox: { scope: 'mine', channels: { email: true, push: true } },
  advertising: { enabled: true, channels: { email: true, push: true } },
  leads: { scope: 'all', channels: { email: false, push: true } },
  ...overrides,
});

describe('resolveNotificationDelivery', () => {
  it('delivers an appointment to the assignee when scope is "mine"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs(),
        type: 'appointment_cancelled',
        isAssignee: true,
      })
    ).toEqual({ email: true, push: true });
  });

  it('skips a non-assignee when appointment scope is "mine"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs(),
        type: 'appointment_booked',
        isAssignee: false,
      })
    ).toBeNull();
  });

  it('delivers to a non-assignee when appointment scope is "all"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          appointments: {
            scope: 'all',
            channels: { email: false, push: true },
          },
        }),
        type: 'appointment_booked',
        isAssignee: false,
      })
    ).toEqual({ email: false, push: true });
  });

  it('skips entirely when appointment scope is "off"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          appointments: { scope: 'off', channels: { email: true, push: true } },
        }),
        type: 'appointment_rescheduled',
        isAssignee: true,
      })
    ).toBeNull();
  });

  it('gates inbox handoffs on the inbox category', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          inbox: { scope: 'all', channels: { email: true, push: false } },
        }),
        type: 'chatbot_handoff',
        isAssignee: false,
      })
    ).toEqual({ email: true, push: false });
  });

  it('gates ad rejections on advertising.enabled', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          advertising: {
            enabled: false,
            channels: { email: true, push: true },
          },
        }),
        type: 'ad_rejected',
        isAssignee: false,
      })
    ).toBeNull();
    expect(
      resolveNotificationDelivery({
        preferences: prefs(),
        type: 'ad_rejected',
        isAssignee: false,
      })
    ).toEqual({ email: true, push: true });
  });
});

describe('withPreferenceDefaults', () => {
  it('returns full defaults for null', () => {
    const result = withPreferenceDefaults(null);
    expect(result.appointments.scope).toBe('mine');
    expect(result.advertising.enabled).toBe(true);
    expect(result.inbox.channels).toEqual({ email: true, push: true });
  });

  it('merges partial stored JSON over defaults', () => {
    const result = withPreferenceDefaults({
      appointments: { scope: 'all', channels: { email: false, push: true } },
    });
    expect(result.appointments.scope).toBe('all');
    expect(result.appointments.channels.email).toBe(false);
    // Untouched categories fall back to defaults.
    expect(result.inbox.scope).toBe('mine');
    expect(result.advertising.enabled).toBe(true);
  });

  // The reason adding the `leads` category needs no migration: every existing
  // row's JSON predates it and must still yield a complete, notifying object.
  it('fills in the leads category for preferences stored before it existed', () => {
    const result = withPreferenceDefaults({
      appointments: { scope: 'mine', channels: { email: true, push: true } },
      inbox: { scope: 'mine', channels: { email: true, push: true } },
      advertising: { enabled: true, channels: { email: true, push: true } },
    });
    expect(result.leads).toEqual({
      scope: 'all',
      channels: { email: false, push: true },
    });
  });
});

describe('resolveNotificationDelivery — leads', () => {
  it('delivers a new lead to every member by default (scope "all")', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs(),
        type: 'lead_created',
        isAssignee: false,
      })
    ).toEqual({ email: false, push: true });
  });

  it('skips a non-owner when lead scope is "mine"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          leads: { scope: 'mine', channels: { email: false, push: true } },
        }),
        type: 'lead_created',
        isAssignee: false,
      })
    ).toBeNull();
  });

  it('skips everyone when lead scope is "off"', () => {
    expect(
      resolveNotificationDelivery({
        preferences: prefs({
          leads: { scope: 'off', channels: { email: false, push: true } },
        }),
        type: 'lead_created',
        isAssignee: true,
      })
    ).toBeNull();
  });
});
