import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  addListener: vi.fn(),
  apiPost: vi.fn(),
  intercomPushToken: vi.fn(),
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  register: vi.fn(),
}));

vi.mock('@capacitor-community/intercom', () => ({
  Intercom: { sendPushTokenToIntercom: h.intercomPushToken },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: h.isNativePlatform,
    getPlatform: h.getPlatform,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: h.addListener,
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: h.register,
    unregister: vi.fn(),
  },
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { delete: vi.fn(), post: h.apiPost },
  getApiClientConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
}));

vi.mock('@/lib/log-error', () => ({ logError: vi.fn() }));

const TOKEN = 'device-token';

async function loadPushModule(platform: 'ios' | 'android') {
  vi.resetModules();
  h.getPlatform.mockReturnValue(platform);

  let registrationHandler: ((token: { value: string }) => void) | undefined;
  h.addListener.mockImplementation(
    async (event: string, handler: (token: { value: string }) => void) => {
      if (event === 'registration') registrationHandler = handler;
      return { remove: vi.fn() };
    }
  );
  h.register.mockImplementation(async () => {
    registrationHandler?.({ value: TOKEN });
  });

  return import('./push');
}

describe('registerForPushNotifications Intercom forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isNativePlatform.mockReturnValue(true);
    h.apiPost.mockResolvedValue(undefined);
    h.intercomPushToken.mockResolvedValue(undefined);
  });

  it('does not call the Android-only bridge method when iOS registers an APNs token', async () => {
    const { registerForPushNotifications } = await loadPushModule('ios');

    await registerForPushNotifications();
    await vi.waitFor(() =>
      expect(h.apiPost).toHaveBeenCalledWith('notifications/push-token', {
        platform: 'ios',
        token: TOKEN,
        tokenType: 'apns',
      })
    );

    // The iOS plugin observes Capacitor's native registration notification and
    // calls Intercom.setDeviceToken itself. Its JS bridge does not implement
    // sendPushTokenToIntercom, so invoking it here would recreate WEB-15.
    expect(h.intercomPushToken).not.toHaveBeenCalled();
  });

  it('forwards an FCM token through the bridge on Android', async () => {
    const { registerForPushNotifications } = await loadPushModule('android');

    await registerForPushNotifications();
    await vi.waitFor(() =>
      expect(h.intercomPushToken).toHaveBeenCalledWith({ value: TOKEN })
    );
  });
});
