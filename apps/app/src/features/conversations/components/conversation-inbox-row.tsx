import type { ConversationListItem } from '@/features/conversations/api';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import { format } from 'date-fns';

import { ConversationHandlerBadge } from './conversation-handler-badge';
import { ConversationPlatformAvatar } from './conversation-platform-avatar';

function formatMessageTime(iso: string): string {
  return format(new Date(iso), 'h:mm a');
}

interface ConversationInboxRowProps {
  conversation: ConversationListItem;
  isSelected: boolean;
  memberFirstNameById: Map<string, string>;
  variant?: 'sidebar' | 'mobile';
  /**
   * When provided, selecting the row calls this instead of navigating to
   * `/dashboard/conversations` — used by the admin panel, which controls
   * selection locally rather than via the route.
   */
  onSelect?: (id: string) => void;
}

export function ConversationInboxRow({
  conversation,
  isSelected,
  memberFirstNameById,
  variant = 'mobile',
  onSelect,
}: ConversationInboxRowProps) {
  const routes = useResolvedRoutes();
  const displayName =
    conversation.externalUserName ?? conversation.externalUserId;
  const isUnread = conversation.lastMessageRole === 'user';
  const isMobile = variant === 'mobile';

  const rowClassName = cn(
    'flex w-full items-start gap-3 px-4 py-4 text-left transition-colors',
    isMobile
      ? 'border-b border-[#F2F2F7] hover:bg-[#FAFAFA] active:bg-[#F2F2F7]'
      : 'rounded-xl bg-sidebar px-3 py-3 hover:bg-sidebar-accent',
    isSelected &&
      (isMobile
        ? 'bg-[#F2F2F7]'
        : 'bg-primary text-primary-foreground hover:bg-primary')
  );

  const isPrimarySelected = !isMobile && isSelected;

  const rowContent = (
    <>
      <ConversationPlatformAvatar
        name={displayName}
        avatarUrl={conversation.externalUserAvatar}
        platform={conversation.platform}
      />

      <div className="min-w-0 flex-1">
        {/*
          THE NAME OWNS THE FIRST LINE.

          The handler badge used to sit beside it, and in a list column this
          narrow the two could not both fit: the badge takes its natural width
          and the name — the only `truncate` element — absorbs all of the
          shrinking. An "Unassigned" badge left about seven characters, so the
          list read "Ja…", "Em…", "Chl…" and you could not tell who a
          conversation was with. The badge's own width decided how much of the
          customer's name you got, which is exactly backwards: the name is what
          you scan the inbox by.

          The badge moves to the second line beside the message preview, where
          it is still visible but competes only with a string that is expected
          to be clipped.
        */}
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15px] font-bold leading-5',
              isPrimarySelected ? 'text-primary-foreground' : 'text-black'
            )}
          >
            {displayName}
          </span>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {conversation.lastMessageAt ? (
              <span
                className={cn(
                  'whitespace-nowrap text-[13px] leading-4',
                  isPrimarySelected
                    ? 'text-primary-foreground/75'
                    : 'text-[#8E8E93]'
                )}
              >
                {formatMessageTime(conversation.lastMessageAt)}
              </span>
            ) : null}
            {isUnread ? (
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  isPrimarySelected ? 'bg-primary-foreground' : 'bg-[#2E65F3]'
                )}
                aria-label="Unread"
              />
            ) : null}
          </div>
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          <ConversationHandlerBadge
            conversation={conversation}
            memberFirstNameById={memberFirstNameById}
            className={cn(
              'shrink-0',
              isPrimarySelected &&
                'bg-primary-foreground/20 text-primary-foreground'
            )}
          />
          {conversation.lastMessageContent ? (
            <p
              className={cn(
                'min-w-0 flex-1 truncate text-[14px] leading-5',
                isPrimarySelected
                  ? 'text-primary-foreground/80'
                  : 'text-[#3C3C43]'
              )}
            >
              {conversation.lastMessageContent}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className={rowClassName}
        aria-label={`Open conversation with ${displayName}`}
      >
        {rowContent}
      </button>
    );
  }

  return (
    <Link
      to={routes.conversations}
      search={{ id: conversation.id }}
      className={rowClassName}
      role="listitem"
      aria-label={`Open conversation with ${displayName}`}
    >
      {rowContent}
    </Link>
  );
}
