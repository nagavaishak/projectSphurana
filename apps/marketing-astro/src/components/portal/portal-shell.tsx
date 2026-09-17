'use client';

import { LogOutIcon } from 'lucide-react';
import type * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useGetOrgBranding } from './api/get-org-branding.hook';
import { useLogoutPatient } from './api/logout-patient.hook';
import {
  usePortal,
  usePortalLink,
  usePortalNavigate,
} from './api/portal-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Authed portal chrome: a slim sticky top bar with the clinic's branding on
 * the left and an account/sign-out control on the right, above a comfortable
 * reading-width content column. Used by every signed-in portal page.
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const { organizationSlug } = usePortal();
  const { branding, isLoading } = useGetOrgBranding();
  const link = usePortalLink();
  const navigate = usePortalNavigate();

  // After the local session is cleared (on success OR failure), send the
  // patient to this microsite's sign-in — the session is gone, so staying on
  // an authed screen would just bounce on the next fetch. `replace` so Back
  // cannot return to a page that will now 401.
  const goToSignIn = () => navigate('/sign-in', { replace: true });
  const { logout, isLoggingOut } = useLogoutPatient({
    onSuccess: goToSignIn,
    onError: goToSignIn,
  });

  const clinicName = branding?.organizationName ?? organizationSlug;
  const initials = clinicName.substring(0, 2).toUpperCase();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-[720px] items-center gap-3 px-4 lg:px-6">
          <a
            href={link()}
            className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {isLoading ? (
              <>
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="h-4 w-28" />
              </>
            ) : (
              <>
                <Avatar className="size-9 rounded-lg">
                  {branding?.organizationLogo && (
                    <AvatarImage
                      src={branding.organizationLogo}
                      alt={clinicName}
                      className="rounded-lg"
                    />
                  )}
                  <AvatarFallback className="rounded-lg text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate font-semibold text-sm">
                  {clinicName}
                </span>
              </>
            )}
          </a>

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                disabled={isLoggingOut}
                className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50"
              >
                <LogOutIcon className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => logout()}
                  disabled={isLoggingOut}
                >
                  <LogOutIcon className="size-4" aria-hidden />
                  {isLoggingOut ? 'Signing out…' : 'Sign out'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        {children}
      </main>
    </div>
  );
}

/** The gate's generic failure state, so six pages don't each hand-roll one. */
export function PortalErrorState({
  icon,
  title,
  description,
  onRetry,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-xl [&>svg]:size-5">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground max-w-sm text-sm text-balance">
          {description}
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
