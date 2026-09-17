import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useResendVerification } from '@/features/auth/use-resend-verification';
import { useSignOut } from '@/features/auth/use-sign-out';
import { ROUTES } from '@/lib/route-paths';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Bell, Bug, ChevronRight, LogOut, User } from 'lucide-react';

/**
 * Debug bench entry — E2E builds only. The CI mobile-E2E APK bakes
 * VITE_TAP_TO_PAY_SIMULATE=true (never committed to .env.production), so
 * nightly/08-tap-to-pay can reach /dashboard/debug through a real in-app tap
 * path instead of a deep link. Dev and Play Store / TestFlight builds leave the
 * flag unset → the entry stays hidden. (/dashboard/debug is still reachable by
 * typing the URL in dev.)
 */
const showDebugEntry = import.meta.env.VITE_TAP_TO_PAY_SIMULATE === 'true';
import type { LucideIcon } from 'lucide-react';

export const Route = createFileRoute('/_authed/dashboard/account')({
  component: AccountPage,
});

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function AccountPage() {
  const { data, isLoading } = useSession();
  const user = data?.user;
  const { signOut, isSigningOut } = useSignOut();
  const { resendVerification, isResending } = useResendVerification();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Personal area</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-8 w-48" />
          ) : (
            <h1 className="mt-1 truncate text-3xl font-bold tracking-tight">
              {user?.name ?? 'User'}
            </h1>
          )}
          {isLoading ? (
            <Skeleton className="mt-2 h-4 w-32" />
          ) : (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {user?.email}
            </p>
          )}
        </div>
        <Avatar className="h-16 w-16 shrink-0">
          <AvatarImage
            src={user?.image ?? undefined}
            alt={user?.name ?? 'User'}
          />
          <AvatarFallback className="text-base font-semibold">
            {getInitials(user?.name)}
          </AvatarFallback>
        </Avatar>
      </header>

      {user && user.emailVerified === false ? (
        <button
          type="button"
          onClick={() => resendVerification({ email: user.email })}
          disabled={isResending}
          className="mt-6 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">Verify your email address</p>
            <p className="text-xs text-muted-foreground">
              {isResending ? 'Sending…' : 'Secure your account'}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      <SectionLabel>Personal</SectionLabel>
      <MenuGroup>
        <MenuLink
          to={ROUTES.settings}
          icon={User}
          label="Profile"
          testId="account-menu-profile"
        />
        <MenuLink
          to={ROUTES.settingsNotifications}
          icon={Bell}
          label="Notifications"
          testId="account-menu-notifications"
        />
      </MenuGroup>

      {/*
        BUSINESS SETTINGS DELIBERATELY DO NOT LIVE HERE.

        This page is reached by tapping your avatar, and everything behind that
        gesture should be about YOU: your profile, your notifications, signing
        out. It had grown into a second settings menu — Details, Bookings,
        Blocked time types, Services, Consent forms, Brand style, AI Assistant,
        Claire WhatsApp and Integrations were all reachable from BOTH here and
        More, and Services appeared under "Business" while also being a Catalog
        tab. Two routes to the same page taught two different mental models of
        where the setting lives, and neither survived contact with the other.

        The business now has exactly one home on mobile: More → Organisation
        settings, which is the same `dashboardNavSections` config the desktop
        sidebar renders — so the two navigations cannot drift again.

        Billing is the one item that did not move, because it was never meant to
        be self-serve: `dashboard-nav.ts` documents it as deliberately absent
        from navigation (support links people straight to it). Surfacing it here
        contradicted that decision; removing it settles the contradiction rather
        than creating a gap.
      */}

      <SectionLabel>Account</SectionLabel>
      <MenuGroup>
        <MenuButton
          onClick={() => signOut()}
          disabled={isSigningOut}
          icon={LogOut}
          label={isSigningOut ? 'Signing out…' : 'Log out'}
          destructive
        />
      </MenuGroup>

      {showDebugEntry ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <MenuGroup>
            <MenuLink
              to="/dashboard/debug"
              icon={Bug}
              label="Debug"
              testId="account-menu-debug"
            />
          </MenuGroup>
        </>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul className="flex flex-col divide-y">{children}</ul>
    </Card>
  );
}

function MenuLink({
  to,
  icon,
  label,
  testId,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  testId?: string;
}) {
  return (
    <li>
      <Link
        to={to}
        // Real DOM id alongside the testid — Maestro's devtools driver matches
        // `id:` against the HTML id attribute (see mobile-header-user-menu).
        id={testId}
        data-testid={testId}
        className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-accent/50"
      >
        <MenuRowContent icon={icon} label={label} />
      </Link>
    </li>
  );
}

function MenuButton({
  onClick,
  disabled,
  icon,
  label,
  destructive,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
}) {
  return (
    <li>
      <Button
        variant="ghost"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'h-auto w-full justify-start gap-3 rounded-none px-4 py-3.5 font-normal',
          destructive && 'text-destructive hover:text-destructive'
        )}
      >
        <MenuRowContent icon={icon} label={label} destructive={destructive} />
      </Button>
    </li>
  );
}

function MenuRowContent({
  icon: Icon,
  label,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
}) {
  return (
    <>
      <Icon
        className={cn(
          'size-5 shrink-0',
          destructive ? 'text-destructive' : 'text-muted-foreground'
        )}
        aria-hidden
      />
      <span className="flex-1 truncate text-left text-sm">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}
