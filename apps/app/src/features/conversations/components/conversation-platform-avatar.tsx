import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { MessagingPlatform } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import {
  Facebook,
  Instagram,
  MessageCircle,
  MessageSquare,
} from 'lucide-react';
import type { ElementType } from 'react';

const platformOverlay: Record<
  MessagingPlatform,
  { icon: ElementType; className: string }
> = {
  facebook_messenger: {
    icon: Facebook,
    className: 'bg-[#1877F2] text-white',
  },
  instagram_dm: {
    icon: Instagram,
    className:
      'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white',
  },
  whatsapp: {
    icon: MessageCircle,
    className: 'bg-[#25D366] text-white',
  },
  sms: {
    icon: MessageSquare,
    // No brand colour for SMS — use the theme's neutral so it reads as the
    // carrier channel rather than a third-party platform.
    className: 'bg-muted-foreground text-background',
  },
};

interface ConversationPlatformAvatarProps {
  name: string;
  avatarUrl?: string | null;
  platform: MessagingPlatform;
  /** Inbox row (48px) vs thread header (56px). */
  size?: 'inbox' | 'thread';
  className?: string;
}

export function ConversationPlatformAvatar({
  name,
  avatarUrl,
  platform,
  size = 'inbox',
  className,
}: ConversationPlatformAvatarProps) {
  const overlay =
    platformOverlay[platform] ?? platformOverlay.facebook_messenger;
  const Icon = overlay.icon;
  const isThread = size === 'thread';

  return (
    <div
      className={cn(
        'relative shrink-0',
        isThread ? 'size-14' : 'size-12',
        className
      )}
    >
      <Avatar className={isThread ? 'size-14' : 'size-12'}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback
          className={cn(
            'bg-[#F2F2F7] font-medium text-[#3C3C43]',
            isThread ? 'text-base' : 'text-sm'
          )}
        >
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-white',
          isThread ? 'size-[22px]' : 'size-5',
          overlay.className
        )}
      >
        <Icon className={isThread ? 'size-3' : 'size-2.5'} strokeWidth={2.5} />
      </span>
    </div>
  );
}
