import { describe, expect, it } from 'vitest';

import { PatientApiError } from '@/lib/patient-fetch';

import { decideAuthGate } from './auth-gate';

const patient = { leadId: 'lead-1', email: 'a@b.com' };

describe('decideAuthGate', () => {
  it('waits while the session query is in flight', () => {
    expect(
      decideAuthGate({
        isLoading: true,
        isError: false,
        error: null,
        patient: null,
      })
    ).toEqual({ kind: 'loading' });
  });

  it('renders the page once a patient is loaded', () => {
    expect(
      decideAuthGate({ isLoading: false, isError: false, error: null, patient })
    ).toEqual({ kind: 'ready' });
  });

  it('sends a 401 to sign-in', () => {
    expect(
      decideAuthGate({
        isLoading: false,
        isError: true,
        error: new PatientApiError('Unauthorized', 401),
        patient: null,
      })
    ).toEqual({ kind: 'redirect-to-sign-in' });
  });

  it('does NOT send a 403 to sign-in — that would loop', () => {
    // 403 = signed in, but not a patient of THIS clinic. Redirecting to a
    // sign-in the customer already completed bounces them forever.
    expect(
      decideAuthGate({
        isLoading: false,
        isError: true,
        error: new PatientApiError('Forbidden', 403),
        patient: null,
      })
    ).toEqual({ kind: 'error' });
  });

  it('offers a retry on a server error rather than signing the customer out', () => {
    expect(
      decideAuthGate({
        isLoading: false,
        isError: true,
        error: new PatientApiError('Internal', 500),
        patient: null,
      })
    ).toEqual({ kind: 'error' });
  });

  it('offers a retry when the network never reached the API (status 0)', () => {
    expect(
      decideAuthGate({
        isLoading: false,
        isError: true,
        error: new PatientApiError('Could not reach the server', 0),
        patient: null,
      })
    ).toEqual({ kind: 'error' });
  });

  it('treats a resolved-but-empty session as signed out', () => {
    expect(
      decideAuthGate({
        isLoading: false,
        isError: false,
        error: null,
        patient: null,
      })
    ).toEqual({ kind: 'redirect-to-sign-in' });
  });

  it('reads the status off a ky-shaped error too', () => {
    expect(
      decideAuthGate({
        isLoading: false,
        isError: true,
        error: { response: { status: 401 } },
        patient: null,
      })
    ).toEqual({ kind: 'redirect-to-sign-in' });
  });
});
