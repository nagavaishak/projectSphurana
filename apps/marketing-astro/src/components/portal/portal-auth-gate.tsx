'use client';

import type * as React from 'react';

import { useGetCurrentPatient } from './api/get-current-patient.hook';
import { PortalRedirect } from './api/portal-provider';
import type { CurrentPatient } from './api/types';
import { decideAuthGate } from './auth-gate';
import { PortalErrorState, PortalShell } from './portal-shell';

/**
 * The gate every authed portal page opens with.
 *
 * apps/app repeated this block verbatim in four routes. Here it is one
 * component wrapping a render-prop, so the redirect decision lives in exactly
 * one place (`decideAuthGate`, which has tests) and a page can only get it
 * wrong by not using it.
 */
export function PortalAuthGate({
  skeleton,
  errorIcon,
  errorTitle,
  errorDescription,
  children,
}: {
  skeleton: React.ReactNode;
  errorIcon: React.ReactNode;
  errorTitle: string;
  errorDescription: string;
  children: (patient: CurrentPatient) => React.ReactNode;
}) {
  const { patient, isLoading, isError, error, refetch } =
    useGetCurrentPatient();

  const decision = decideAuthGate({ isLoading, isError, error, patient });

  if (decision.kind === 'loading') {
    return <PortalShell>{skeleton}</PortalShell>;
  }

  if (decision.kind === 'redirect-to-sign-in') {
    // Built through the portal context, so a tenant's customer lands on the
    // tenant's sign-in — never back on our domain.
    return <PortalRedirect to="/sign-in" />;
  }

  if (decision.kind === 'error' || !patient) {
    return (
      <PortalShell>
        <PortalErrorState
          icon={errorIcon}
          title={errorTitle}
          description={errorDescription}
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return <PortalShell>{children(patient)}</PortalShell>;
}
