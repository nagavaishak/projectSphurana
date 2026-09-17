'use client';

import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, MapPin, Pencil, Plus } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveLocation,
  useBranchAccess,
} from '@/features/organization-locations';
import { ROUTES } from '@/lib/route-paths';

/**
 * The branch selector at the head of the sidebar rail.
 *
 * Occupies shadcn `sidebar-10`'s TeamSwitcher slot at the top of the header,
 * and keeps that block's markup: `w-fit px-1.5` trigger, 5px rounded logo tile,
 * `ChevronDown`, and a `w-64 rounded-lg` menu aligned to the start.
 *
 * Renders as a non-dropdown label when the org has a single location, which
 * is the common case — there is nothing to switch to, and a dropdown that opens
 * onto one item is noise. It is also, for now, the safety catch: the active
 * location does not filter any data yet (see `use-active-location.ts`), so the
 * interactive form must not reach production ahead of the API work.
 */
export function LocationSwitcher() {
  const { location, locations, setLocation, isLoading, isMultiLocation } =
    useActiveLocation();
  // A practitioner sees every branch the business has, but can only open the
  // ones they work at — see `useBranchAccess` for who this applies to.
  const { isRestricted, allowedLocationIds, isAdmin, roleKnown } =
    useBranchAccess();
  // Hidden only when we KNOW this person is not an admin. An unreadable role
  // (a 403 mid org-switch, a failed request) must not remove the controls —
  // see `roleKnown`.
  const hideBranchAdmin = roleKnown && !isAdmin;

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Skeleton className="size-5 rounded-md" />
            <Skeleton className="h-4 w-24" />
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // No locations at all: an org mid-onboarding. Offer the way to fix it — but
  // only to the person who can: adding a branch is admin-gated on the API, so
  // a practitioner is told the state rather than handed a door that 403s.
  if (!location) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          {hideBranchAdmin ? (
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <div className="flex aspect-square size-5 shrink-0 items-center justify-center rounded-md border border-dashed">
                <MapPin className="size-3" />
              </div>
              <span className="truncate text-muted-foreground text-sm">
                No location set up yet
              </span>
            </div>
          ) : (
            <SidebarMenuButton asChild className="w-fit max-w-full px-1.5">
              <Link to={ROUTES.locations}>
                <div className="flex aspect-square size-5 shrink-0 items-center justify-center rounded-md border border-dashed">
                  <Plus className="size-3" />
                </div>
                <span className="truncate font-medium">Add a location</span>
              </Link>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const label = locationLabel(location);

  // One branch: a label, not a switcher — there is nothing to switch to. It
  // LINKS to branch management for an admin, and is inert for everyone else,
  // for the same reason the menu's admin items are hidden.
  if (!isMultiLocation) {
    const badge = (
      <>
        <div className="flex aspect-square size-5 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <MapPin className="size-3" />
        </div>
        <span className="truncate font-medium">{label}</span>
      </>
    );

    return (
      <SidebarMenu>
        <SidebarMenuItem>
          {hideBranchAdmin ? (
            <div className="flex w-fit max-w-full items-center gap-2 px-1.5 py-1.5">
              {badge}
            </div>
          ) : (
            <SidebarMenuButton asChild className="w-fit max-w-full px-1.5">
              <Link to={ROUTES.locations}>{badge}</Link>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              aria-label={`Location: ${label}. Change location.`}
              className="w-fit max-w-full px-1.5"
            >
              <div className="flex aspect-square size-5 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                <MapPin className="size-3" />
              </div>
              <span className="truncate font-medium">{label}</span>
              <ChevronDown className="opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-64 rounded-lg"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Locations
            </DropdownMenuLabel>
            {locations.map((candidate) => {
              const locked =
                isRestricted && !allowedLocationIds.includes(candidate.id);

              return (
                <DropdownMenuItem
                  className="gap-2 p-2"
                  // `disabled` and not "hidden": knowing the branch exists is
                  // the point. What changes is that opening it is not this
                  // person's to do.
                  disabled={locked}
                  key={candidate.id}
                  onClick={locked ? undefined : () => setLocation(candidate.id)}
                >
                  <div className="flex size-6 items-center justify-center rounded-xs border">
                    <MapPin className="size-4 shrink-0" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="min-w-0 truncate">
                      {locationLabel(candidate)}
                    </span>
                    {/*
                      The one thing they can actually do about it. A bare
                      greyed row reads as a bug; this reads as a rule.
                    */}
                    {locked && (
                      <span className="truncate text-muted-foreground text-xs">
                        Contact your manager to be added to this location
                      </span>
                    )}
                  </div>
                  {candidate.id === location.id && (
                    <Check className="size-4 shrink-0 opacity-60" />
                  )}
                </DropdownMenuItem>
              );
            })}
            {/*
              BRANCH ADMINISTRATION — admins and owners only.
              Editing a branch (address, opening hours, which team and
              catalogue it carries) and adding or removing branches are both
              admin-gated on the API. Showing them to a practitioner offers a
              door that 403s, next to a row that has just told them to ask
              their manager.
            */}
            {!hideBranchAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="gap-2 p-2">
                  <Link
                    params={{ entity: 'location', id: location.id }}
                    to="/edit/$entity/$id"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                      <Pencil className="size-4" />
                    </div>
                    <span className="font-medium text-muted-foreground">
                      Edit this location
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="gap-2 p-2">
                  <Link to={ROUTES.locations}>
                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                      <Plus className="size-4" />
                    </div>
                    <span className="font-medium text-muted-foreground">
                      Manage locations
                    </span>
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * `name` is nullable on the table — a single-location org typically never sets
 * one — so fall back to the city, then the street, rather than rendering blank.
 */
function locationLabel(location: {
  name: string | null;
  city: string;
  addressLine1: string;
}): string {
  return location.name?.trim() || location.city || location.addressLine1;
}
