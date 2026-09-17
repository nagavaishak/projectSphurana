import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { Drawer } from 'vaul';

import { useCalendar } from '@/components/calendar';
import { useListServices } from '@/features/organization-services';
import { cn } from '@/lib/utils';

import type { TCalendarView } from '@/components/calendar/types';

interface MobileViewOptionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: TCalendarView;
  basePath: string;
}

const VIEWS: { value: TCalendarView; label: string; path: string }[] = [
  { value: 'day', label: 'Day', path: 'day' },
  { value: 'week', label: 'Week', path: 'week' },
  { value: 'month', label: 'Month', path: 'month' },
  { value: 'agenda', label: 'Agenda', path: 'agenda' },
];

/**
 * Mobile view + filters bottom sheet, opened from the header burger:
 * — View chips (day / week / month / agenda), routed off `basePath`.
 * — Staff Member chips (single-select, mirrors UserSelect semantics; 'all' is
 *   the default first chip).
 * — Service chips.
 *
 * Date selection lives in the separate date-picker sheet behind the header's
 * date dropdown.
 */
export function MobileViewOptionsSheet({
  open,
  onOpenChange,
  view,
  basePath,
}: MobileViewOptionsSheetProps) {
  const {
    selectedUserId,
    setSelectedUserId,
    selectedServiceId,
    setSelectedServiceId,
    users,
  } = useCalendar();
  const { services } = useListServices();
  const navigate = useNavigate();

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-2.5 outline-none">
          <div className="flex shrink-0 flex-col items-center pt-0.5 pb-1">
            <div
              className="h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
          </div>

          <div className="flex items-center justify-between px-5 pt-2 pb-1">
            <Drawer.Title className="text-lg font-semibold">
              View and filters
            </Drawer.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:bg-muted/70"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground">View</h3>
              <div className="flex flex-wrap gap-2">
                {VIEWS.map((option) => (
                  <Chip
                    key={option.value}
                    active={view === option.value}
                    onClick={() => {
                      onOpenChange(false);
                      if (view !== option.value) {
                        navigate({ to: `${basePath}/${option.path}` as never });
                      }
                    }}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </section>

            <section className="mt-5 flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground">Staff Member</h3>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={selectedUserId === 'all'}
                  onClick={() => setSelectedUserId('all')}
                >
                  All
                </Chip>
                {users.map((user) => (
                  <Chip
                    key={user.id}
                    active={selectedUserId === user.id}
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    {user.name.split(' ')[0]}
                  </Chip>
                ))}
              </div>
            </section>

            {services.length > 0 && (
              <section className="mt-5 flex flex-col gap-2">
                <h3 className="text-sm text-muted-foreground">Service</h3>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={selectedServiceId === 'all'}
                    onClick={() => setSelectedServiceId('all')}
                  >
                    All
                  </Chip>
                  {services.map((service) => (
                    <Chip
                      key={service.id}
                      active={selectedServiceId === service.id}
                      onClick={() => setSelectedServiceId(service.id)}
                    >
                      {service.name}
                    </Chip>
                  ))}
                </div>
              </section>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-foreground active:bg-accent'
      )}
    >
      {children}
    </button>
  );
}
