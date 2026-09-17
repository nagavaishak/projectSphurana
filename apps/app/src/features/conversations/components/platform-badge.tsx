import { Badge } from '@/components/ui/badge';
import type { MessagingPlatform } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { Facebook, Instagram, MessageCircle } from 'lucide-react';
import type { ElementType } from 'react';

const platformConfig: Record<
  string,
  {
    icon: ElementType;
    label: string;
    className: string;
  }
> = {
  facebook_messenger: {
    icon: Facebook,
    label: 'Messenger',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  instagram_dm: {
    icon: Instagram,
    label: 'Instagram',
    className: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  },
  whatsapp: {
    icon: MessageCircle,
    label: 'WhatsApp',
    className:
      'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  },
};

interface PlatformBadgeProps {
  platform: MessagingPlatform;
  className?: string;
}

export function PlatformBadge({ platform, className }: PlatformBadgeProps) {
  const config = platformConfig[platform] ?? platformConfig.facebook_messenger;
  const Icon = config.icon;

  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 border-0 px-1.5 py-0 text-[10px] font-normal',
        config.className,
        className
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}
