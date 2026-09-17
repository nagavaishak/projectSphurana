import { useSidePanel } from '@/components/app/side-panel';
import type { IEvent } from '@/components/calendar/interfaces';
import { SocialPostPanel } from '@/features/social-posts';

interface PostDetailsDialogProps {
  event: IEvent;
  children: React.ReactNode;
}

/**
 * Calendar event trigger: clicking an event chip opens the shared, non-modal
 * post side-panel (view + edit). Kept as the calendar's `customEventDetailsDialog`
 * so both the planner calendar and the content-calendar route use the panel.
 */
export function PostDetailsDialog({ event, children }: PostDetailsDialogProps) {
  const { open } = useSidePanel();

  const showPanel = () => open(<SocialPostPanel postId={String(event.id)} />);

  return (
    // Clickable wrapper — bypasses DraggableEvent's drag delay.
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        showPanel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          showPanel();
        }
      }}
    >
      {children}
    </div>
  );
}
