import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { glassInteractiveClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { ROUTES } from '@/lib/route-paths';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';

import { useSession } from '@/lib/session';

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * User avatar in the mobile dashboard header — opens the personal account page.
 */
export function MobileHeaderUserMenu({ className }: { className?: string }) {
  const { data: session } = useSession();

  const name = session?.user?.name ?? session?.user?.email ?? 'Account';
  const avatar = session?.user?.image ?? undefined;
  const initials = getInitials(name);

  return (
    <Link
      to={ROUTES.dashboardAccount}
      // Real DOM id alongside the testid: Maestro's devtools driver reliably
      // matches `id:` against the HTML id attribute (like the sign-in inputs);
      // data-testid alone proved unmatchable in local runs (nightly 05/06/08).
      id="mobile-header-user-menu"
      data-testid="mobile-header-user-menu"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full p-0 transition active:scale-[0.97]',
        glassInteractiveClass,
        className
      )}
      aria-label="Personal area"
    >
      <Avatar className="size-10 rounded-full">
        <AvatarImage src={avatar} alt={name} />
        <AvatarFallback className="rounded-full text-[11px]">
          {initials}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}
