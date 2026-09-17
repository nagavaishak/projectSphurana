import { format } from 'date-fns';
import { Check, FacebookIcon, InstagramIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SingleDayPicker } from '@/components/ui/single-day-picker';
import { cn } from '@/lib/utils';

import type { MetaAdsPage } from '@/features/integrations';

import { acceptBatchItemForm } from '../../api/accept-batch-item';

/** Labels come from the form declaration — the contract locates by these strings. */
const L = acceptBatchItemForm.labels;

function PageToggle({
  page,
  checked,
  onToggle,
}: {
  page: MetaAdsPage;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = page.platform === 'instagram' ? InstagramIcon : FacebookIcon;
  return (
    <button
      type="button"
      onClick={onToggle}
      // `aria-pressed` rather than a nested <Checkbox>: the shadcn checkbox
      // renders its own <button>, and a button inside a button is invalid DOM
      // that React warns about — the inner control also swallowed the click
      // target for anyone navigating by keyboard.
      aria-pressed={checked}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
        checked
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-muted'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input'
        )}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
      <Icon
        className={cn(
          'size-4',
          page.platform === 'instagram' ? 'text-pink-600' : 'text-blue-600'
        )}
      />
      <span className="max-w-[140px] truncate">
        {page.pageName ?? page.platform}
      </span>
    </button>
  );
}

export interface ScheduleControlsProps {
  /**
   * Classes for the TRIGGER, so a host can size it to sit with its neighbours.
   *
   * The content panel puts it beside Reject and Save at `h-7`; left at the
   * default the three buttons were three different heights in one row.
   */
  triggerClassName?: string;
  pages: MetaAdsPage[];
  selectedPageIds: string[];
  onTogglePage: (pageId: string) => void;
  scheduleAt: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  onTimeChange: (value: string) => void;
  /** Accept the post at the chosen date and time. */
  onConfirm: () => void;
  canConfirm: boolean;
  isConfirming?: boolean;
}

/**
 * Where and when to post. Shared body for the desktop popover and the mobile
 * sheet — one implementation so the two can't drift.
 */
function ScheduleControlsBody({
  pages,
  selectedPageIds,
  onTogglePage,
  scheduleAt,
  onDateChange,
  onTimeChange,
  onConfirm,
  canConfirm,
  isConfirming,
}: ScheduleControlsProps) {
  const timeValue = scheduleAt ? format(scheduleAt, 'HH:mm') : '';

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">{L.scheduledAt}</Label>
        <div className="flex items-center gap-2">
          <SingleDayPicker
            value={scheduleAt}
            onSelect={onDateChange}
            placeholder="Pick a date"
            className="flex-1"
          />
          <input
            type="time"
            value={timeValue}
            onChange={(e) => onTimeChange(e.target.value)}
            disabled={!scheduleAt}
            aria-label="Time to post"
            className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          />
        </div>
        {!scheduleAt && (
          <span className="text-xs text-muted-foreground">
            Pick a date, or close this and hit Save to keep it as a draft.
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{L.targetPageIds}</Label>
        {pages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No connected pages. Connect a Facebook or Instagram page to schedule
            this post.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pages.map((page) => (
              <PageToggle
                key={page.id}
                page={page}
                checked={selectedPageIds.includes(page.id)}
                onToggle={() => onTogglePage(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* The commit lives WITH the fields it commits. A Schedule button outside
          the popover would let someone pick a date, dismiss, and hit it without
          ever seeing what they'd chosen. */}
      <Button
        type="button"
        onClick={onConfirm}
        disabled={!canConfirm || isConfirming}
        className="w-full gap-2"
      >
        {isConfirming ? <Loader2 className="size-4 animate-spin" /> : null}
        Schedule
      </Button>
    </div>
  );
}

/**
 * A popover on desktop, a sheet on mobile.
 *
 * Date, time and the page picker need real room, and a dialog inside a dialog
 * can never give it to them — which is the whole reason the review surface is a
 * route rather than a modal.
 */
export function ScheduleControls(
  props: ScheduleControlsProps & { isMobile: boolean }
) {
  const { isMobile, triggerClassName, ...body } = props;

  // The trigger always reads "Schedule". It used to swap to the chosen
  // date/time once one was picked, which made the primary action's label change
  // under the user mid-task and left the pair reading "Save / Thu 30 Jul,
  // 19:15" — two buttons that no longer look like the same kind of choice. The
  // chosen time is shown inside the popover, where it is being edited.
  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" className={cn('w-full', triggerClassName)}>
            Schedule
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="p-4">
          <SheetHeader className="px-0">
            <SheetTitle>Schedule this post</SheetTitle>
          </SheetHeader>
          <ScheduleControlsBody {...body} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" className={triggerClassName}>
          Schedule
        </Button>
      </PopoverTrigger>
      {/* Opens UPWARDS: the trigger sits in the footer at the bottom of the
          viewport, so a downward popover would open off-screen. */}
      <PopoverContent side="top" align="end" sideOffset={8} className="w-96">
        <ScheduleControlsBody {...body} />
      </PopoverContent>
    </Popover>
  );
}
