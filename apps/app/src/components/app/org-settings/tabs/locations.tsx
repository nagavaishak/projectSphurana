'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteLocation,
  useListLocations,
  useSetPrimaryLocation,
} from '@/features/organization-locations';
import type { OrganizationLocation } from '@/features/organization-locations';
import { Link } from '@tanstack/react-router';
import { MapPin, MoreVertical, Star } from 'lucide-react';
import { OpeningHoursSummary } from './opening-hours';

function LocationCard({ location }: { location: OrganizationLocation }) {
  const { deleteLocation, isDeleting } = useDeleteLocation();
  const { setPrimaryLocation, isSettingPrimary } = useSetPrimaryLocation();

  const displayName =
    location.name || `${location.addressLine1}, ${location.city}`;
  const displayAddress = [
    location.addressLine1,
    location.city,
    location.country.toUpperCase(),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <Card>
        <CardContent className="flex items-start gap-4 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
            <MapPin className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{displayName}</p>
              {location.isPrimary && (
                <Badge variant="secondary" className="shrink-0">
                  <Star className="mr-1 h-3 w-3" />
                  Primary
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {displayAddress}
            </p>
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Opening hours
              </p>
              <OpeningHoursSummary openingHours={location.openingHours} />
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={isDeleting || isSettingPrimary}
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                {/*
                  Editing a branch is a page, not a dialog: it now covers the
                  address, the opening hours AND which practitioners, services,
                  products, plans and promotions the branch offers — far past
                  what a modal can hold.
                */}
                <Link
                  params={{ entity: 'location', id: location.id }}
                  to="/edit/$entity/$id"
                >
                  Edit
                </Link>
              </DropdownMenuItem>
              {!location.isPrimary && (
                <DropdownMenuItem
                  onClick={() => setPrimaryLocation(location.id)}
                >
                  Set as Primary
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => deleteLocation(location.id)}
                className="text-red-600"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>
    </>
  );
}

export function LocationsTab() {
  const { locations, isLoading, isError, error } = useListLocations();

  if (isLoading) {
    return (
      <div className="w-full px-6 py-4 space-y-4">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[72px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-6">
        <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          Failed to load locations: {error?.message || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="w-full px-6 py-4 space-y-4">
        {/*
          ABOVE the list, not below it. Every other list surface in the product
          (Customers, Services, Team) puts its primary action at the top; this
          one sat under the last card, so with three branches you had to scroll
          to find "Add Location" and with twenty it was off-screen entirely.
          Kept inside this component rather than lifted into the page header
          because the tab is ALSO hosted in the org-settings dialog, which has
          no header to lift it into — one placement serves both.

          The shared entity editor, like every other create/edit surface in the
          app. A bespoke five-step funnel lived here briefly (plan §8) on the
          reasoning that a new branch is empty in all eight sections; it has
          been reverted, so adding a branch works the way adding a service, a
          product or a team member does. Following the link from inside the
          settings dialog closes it, which is correct: the destination is a
          full-page task.
        */}
        <div className="flex justify-end">
          <Button asChild size="sm" variant="outline">
            <Link params={{ entity: 'location' }} to="/create/$entity">
              Add Location
            </Link>
          </Button>
        </div>

        {locations.map((location) => (
          <LocationCard key={location.id} location={location} />
        ))}

        {locations.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MapPin />
              </EmptyMedia>
              <EmptyTitle>No branches yet</EmptyTitle>
              <EmptyDescription>
                Add a branch to give it its own calendar, team and opening
                hours.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ScrollArea>
  );
}
