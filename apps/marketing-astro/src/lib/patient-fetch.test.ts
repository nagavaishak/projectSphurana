import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PatientApiError,
  patientFetch,
  setSessionExpiredHandler,
} from './patient-fetch';

const okResponse = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
  setSessionExpiredHandler(null);
});

// Typed structurally rather than as `ReturnType<typeof vi.spyOn>`: that
// generic resolves to the unknown-arg overload, which `fetch`'s own overloaded
// signature is not assignable to. All this helper needs is the recorded args.
const lastCall = (spy: { mock: { calls: unknown[][] } }) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

describe('patientFetch', () => {
  it('calls the SAME-ORIGIN proxy, never the API host directly', () => {
    // The whole cookie-only design rests on this: an absolute api.borradh.io
    // URL is cross-site on a tenant domain, which is what forced the bearer
    // token in the first place. It also violates the marketing CSP.
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    void patientFetch('patient/me', { organizationSlug: 'glow' });

    const { url, init } = lastCall(spy);
    expect(url).toBe('/api/patient/me');
    expect(url).not.toMatch(/^https?:/);
    expect(init.credentials).toBe('same-origin');
  });

  it('sends NO Authorization header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await patientFetch('patient/me', { organizationSlug: 'glow' });

    // A regression here silently reintroduces a JS-readable session credential
    // on a page that renders custom_html. It must stay absent.
    expect(lastCall(spy).headers.get('authorization')).toBeNull();
  });

  it('sends the org as a header — the CSRF control as well as the tenancy one', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await patientFetch('patient/me', { organizationSlug: 'glow' });

    // A cross-site form POST cannot set a custom header, so requiring one is
    // what makes cookie auth safe here. See plan §6.6.
    expect(lastCall(spy).headers.get('x-portal-org')).toBe('glow');
  });

  it('throws loudly rather than calling with a missing org slug', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await expect(
      patientFetch('patient/me', { organizationSlug: '' })
    ).rejects.toBeInstanceOf(PatientApiError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('signals session-expired on a 401 by default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 401 })
    );
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    await expect(
      patientFetch('patient/me', { organizationSlug: 'glow' })
    ).rejects.toBeInstanceOf(PatientApiError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('does NOT signal session-expired when the caller says keep-session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 401 })
    );
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    // The booking prefill asks /patient/me for a clinic the customer may not be
    // a patient of. Treating that 401 as sign-out logged people out of a clinic
    // they WERE signed in to — a real bug the original carried a comment about.
    await expect(
      patientFetch('patient/me', {
        organizationSlug: 'glow',
        onUnauthorized: 'keep-session',
      })
    ).rejects.toBeInstanceOf(PatientApiError);
    expect(expired).not.toHaveBeenCalled();
  });

  it('surfaces the API error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Code expired' }), { status: 400 })
    );

    await expect(
      patientFetch('public/patient-auth/verify-otp', {
        organizationSlug: 'glow',
        method: 'POST',
        body: { code: '123456' },
      })
    ).rejects.toMatchObject({ message: 'Code expired', status: 400 });
  });

  it('returns undefined for an empty body rather than throwing on JSON.parse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await expect(
      patientFetch('patient/logout', {
        organizationSlug: 'glow',
        method: 'POST',
      })
    ).resolves.toBeUndefined();
  });

  it('maps an unreachable server to a PatientApiError, not a raw TypeError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));

    await expect(
      patientFetch('patient/me', { organizationSlug: 'glow' })
    ).rejects.toBeInstanceOf(PatientApiError);
  });
});
