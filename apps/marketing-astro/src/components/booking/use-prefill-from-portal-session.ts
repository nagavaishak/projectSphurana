'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { patientFetch } from '@/lib/patient-fetch';

import type { GuestDetails } from './wizard-confirm-step';

/** The subset of `GET patient/me` the booking form fills itself from. */
interface CurrentPatient {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
}

/**
 * Prefill the booking form for a customer who is already signed in to this
 * clinic's portal.
 *
 * The booking wizard is a public page, so it asked an existing, signed-in
 * customer to retype the name and email their portal already holds. This
 * fills those in once, from the portal session, if there is one.
 *
 * Three details matter, and two of them are the reason this is a hook and not
 * three lines inline:
 *
 *  - The org slug is PASSED IN, never derived. apps/app's version parsed it out
 *    of a `/portal/{slug}` URL, which cannot work here at all: under
 *    host-implies-org the path is `/portal/bookings` and that regex matches
 *    `bookings`. `patientFetch` takes it as a required argument for exactly
 *    this reason.
 *
 *  - A 401 here MUST NOT sign the customer out — hence
 *    `onUnauthorized: 'keep-session'`. It is the ordinary answer for someone
 *    who is not a patient of THIS clinic, including a customer perfectly well
 *    signed in to another one. Treating it as "session gone" logged people out
 *    of the clinic they were actually using, just for visiting a second
 *    clinic's public booking page.
 *
 *  - The prefill applies ONCE and never overwrites typing. A late-arriving
 *    response must not clobber what the person has already entered — and a
 *    guest booking on someone else's behalf has to stay free to edit.
 */
export function usePrefillFromPortalSession(
  organizationSlug: string,
  applyPrefill: (details: Partial<GuestDetails>) => void
): void {
  // A 401 here is the normal case (not signed in, or not a patient of this
  // clinic) — never surfaced as an error, and never a reason to sign out.
  const { data: patient } = useQuery<CurrentPatient>({
    queryKey: ['patient-portal', 'me', organizationSlug],
    queryFn: () =>
      patientFetch<CurrentPatient>('patient/me', {
        organizationSlug,
        onUnauthorized: 'keep-session',
      }),
    enabled: Boolean(organizationSlug),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const applied = useRef(false);

  useEffect(() => {
    if (!patient || applied.current) return;
    applied.current = true;

    applyPrefill({
      firstName: patient.firstName ?? '',
      lastName: patient.lastName ?? '',
      email: patient.email,
      phone: patient.phone ?? '',
    });
  }, [patient, applyPrefill]);
}
