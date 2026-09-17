import { Check, ChevronDown, MapPin } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { glassInteractiveClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import {
  useActiveLocation,
  useBranchAccess,
} from '@/features/organization-locations';
import { useRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

/**
 * Which branch you are looking at, in the mobile header's leading slot — the
 * top-left corner, on the same row as the avatar.
 *
 * WHY IT HAS TO BE HERE. Every branch-scoped surface on mobile (calendar,
 * sales, catalog, team, inventory) shows one branch's data and says so nowhere:
 * the branch lives in the URL, and mobile does not show the URL. Desktop has
 * the switcher pinned at the head of the sidebar; mobile had no equivalent, so
 * a two-branch business could read Cork's diary believing it was Dublin's. That
 * is a data-misreading bug wearing a layout bug's clothes.
 *
 * SINGLE-BRANCH ORGS GET A LABEL, NOT A MENU — the same call the desktop
 * switcher makes. 98 of 104 production orgs have exactly one branch, and a
 * dropdown that opens onto its only option is noise on the most space-starved
 * surface in the product.
 *
 * NOTHING renders when the org has no branch at all. The header is not the
 * place to run an onboarding prompt, and the empty state would otherwise land
 * on every screen at once.
 */
export function MobileHeaderLocation({ className }: { className?: string }) {
  const { location, locations, setLocation, isMultiLocation } =
    useActiveLocation();
  // A practitioner sees every branch the business has but can only open the
  // ones they work at — same rule the desktop switcher applies.
  const { isRestricted, allowedLocationIds } = useBranchAccess();
  // Branch read from the URL, which is null on the org-level pages that sit
  // outside `/dashboard/l/:branch/` — More, Account, Settings, Locations.
  const branchInScope = useRoutes();

  // Org-level page: there is genuinely no branch in scope, so naming one would
  // be a claim the page cannot honour — nothing on More or Settings is filtered
  // by branch. `useActiveLocation()` would still answer (it falls back to the
  // remembered or primary branch), which is exactly why this reads the URL
  // instead. It also gives those pages their header width back.
  if (!branchInScope) return null;

  // No branch resolved yet (loading) or none exists (org mid-onboarding).
  // Render nothing rather than a skeleton: this sits beside the avatar on every
  // screen, so a placeholder flashing on each navigation is worse than a gap.
  if (!location) return null;

  const label = location.name?.trim() || location.city?.trim() || 'Location';

  if (!isMultiLocation) {
    return (
      <div
        className={cn(
          'flex h-12 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-full px-3',
          glassInteractiveClass,
          className
        )}
        data-testid="mobile-header-location"
      >
        <MapPin className="size-4 shrink-0 text-[#525252]" strokeWidth={2} />
        <span className="truncate text-[13px] font-medium text-[#0A0A0A]">
          {label}
        </span>
      </div>
    );
  }

  const openable = (id: string) =>
    !isRestricted || allowedLocationIds.includes(id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Real DOM id alongside the testid, for the same reason the avatar
          // carries one: Maestro matches `id:` against the HTML id attribute.
          id="mobile-header-location"
          data-testid="mobile-header-location"
          aria-label={`Branch: ${label}. Switch branch`}
          className={cn(
            'flex h-12 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-full px-3 transition active:scale-[0.97]',
            glassInteractiveClass,
            className
          )}
        >
          <MapPin className="size-4 shrink-0 text-[#525252]" strokeWidth={2} />
          <span className="truncate text-[13px] font-medium text-[#0A0A0A]">
            {label}
          </span>
          <ChevronDown
            className="size-3.5 shrink-0 text-[#737373]"
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-lg">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch branch
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locations.map((branch) => {
          const canOpen = openable(branch.id);
          return (
            <DropdownMenuItem
              key={branch.id}
              disabled={!canOpen}
              onSelect={() => {
                if (canOpen) setLocation(branch.id);
              }}
              className="gap-2"
            >
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {branch.name?.trim() || branch.city?.trim() || 'Location'}
              </span>
              {branch.id === location.id ? (
                <Check className="size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
