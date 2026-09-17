import { describe, expect, it, vi } from '@borradh-workspace/testing';

import { stopImpersonating } from './stop-impersonating.service.js';

const ADMIN_TOKEN = 'restored-admin-token';

describe('stopImpersonating', () => {
  it('returns the restored admin token so the bearer follows the cookie', async () => {
    const authApi = {
      stopImpersonating: vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          getSetCookie: () => [
            `__Secure-better-auth.session_token=${ADMIN_TOKEN}; Path=/; HttpOnly`,
            'better-auth.admin_session=; Path=/; Max-Age=0',
          ],
        },
        json: async () => ({ user: { id: 'admin-user' } }),
      } as unknown as globalThis.Response),
    };

    const result = await stopImpersonating(authApi, {
      cookieHeader: '__Secure-better-auth.session_token=impersonated',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sessionToken).toBe(ADMIN_TOKEN);
  });
});
