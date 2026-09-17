import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  SWITCHABLE_VIEWS,
  VIEW_LABELS,
  VIEW_ROUTE_SLUGS,
  viewLabel,
} from '@/components/calendar/components/header/view-routes';

import type { TCalendarView } from '@/components/calendar/types';

interface IProps {
  view: TCalendarView;
  basePath: string;
}

/**
 * Day / 3 day / Week / Month view switcher. Navigates between the nested
 * calendar routes under `basePath` (e.g. `/dashboard/calendar/day`).
 */
export function ViewSelect({ view, basePath }: IProps) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 font-medium">
          {viewLabel(view)}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {SWITCHABLE_VIEWS.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() =>
              navigate({
                to: `${basePath}/${VIEW_ROUTE_SLUGS[option]}` as never,
              })
            }
          >
            <Check
              className={option === view ? 'size-4' : 'size-4 opacity-0'}
            />
            {VIEW_LABELS[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
