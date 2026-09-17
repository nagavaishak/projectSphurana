import { glassInteractiveClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import { MessageCircle } from 'lucide-react';

/**
 * Inbox shortcut in the mobile dashboard header. Inbox used to be a bottom tab;
 * it now sits beside the notifications bell so the tab row can carry the `+`
 * and More actions.
 */
export function MobileHeaderInboxButton({ className }: { className?: string }) {
  const routes = useResolvedRoutes();
  return (
    <Link
      to={routes.conversations}
      // Real DOM id alongside the testid — Maestro's devtools driver matches
      // `id:` against the HTML id attribute (see mobile-header-user-menu).
      id="mobile-header-inbox"
      data-testid="mobile-header-inbox"
      aria-label="Inbox"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full transition active:scale-[0.97]',
        glassInteractiveClass,
        className
      )}
    >
      <MessageCircle className="size-5 text-[#525252]" strokeWidth={2} />
    </Link>
  );
}
