'use client';

import type * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

import { useGetOrgBranding } from './api/get-org-branding.hook';
import { usePortal } from './api/portal-provider';

/**
 * Portal auth chrome: clinic logo + name centered at top, single centered
 * column below (max-w-sm, mobile-first). This is a white-labeled surface —
 * no Borradh logo.
 *
 * The `setPortalOrgSlug` effect that used to live here is gone. The org is a
 * prop on the provider now, so there is no ambient global to pin and no window
 * between mount and effect where a request could go out unscoped.
 */
export function PortalAuthLayout({ children }: { children: React.ReactNode }) {
  const { organizationSlug } = usePortal();
  const { branding, isLoading } = useGetOrgBranding();

  const clinicName = branding?.organizationName ?? organizationSlug;

  return (
    <div className="flex min-h-svh flex-col items-center bg-background p-6 md:p-10">
      <div className="mt-4 mb-8 flex flex-col items-center gap-3">
        {isLoading ? (
          <>
            <Skeleton className="size-16 rounded-2xl" />
            <Skeleton className="h-5 w-32" />
          </>
        ) : (
          <>
            <Avatar className="size-16 rounded-2xl shadow-sm">
              {branding?.organizationLogo && (
                <AvatarImage
                  src={branding.organizationLogo}
                  alt={clinicName}
                  className="rounded-2xl"
                />
              )}
              <AvatarFallback className="rounded-2xl text-base font-semibold">
                {clinicName.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <p className="text-lg font-semibold tracking-tight">{clinicName}</p>
          </>
        )}
      </div>
      <div className="flex w-full flex-1 items-start justify-center">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xs sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
