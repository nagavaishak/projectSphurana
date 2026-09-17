import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from '@/components/ui/message';
import type { ConversationMessage } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Bot, Headset, Info, User } from 'lucide-react';
import type { ComponentProps, ElementType } from 'react';

type BubbleVariant = ComponentProps<typeof Bubble>['variant'];

const roleConfig: Record<
  string,
  {
    align: 'start' | 'end';
    variant: BubbleVariant;
    icon: ElementType;
    label: string;
  }
> = {
  bot: { align: 'start', variant: 'muted', icon: Bot, label: 'Bot' },
  user: { align: 'end', variant: 'default', icon: User, label: 'User' },
  agent: {
    align: 'start',
    variant: 'secondary',
    icon: Headset,
    label: 'Agent',
  },
  system: { align: 'start', variant: 'outline', icon: Info, label: 'System' },
};

interface MessageBubbleProps {
  message: ConversationMessage;
}

/**
 * Placeholder labels produced by `deriveMessageContent` for non-text messages.
 * When we render the actual media (image/sticker) we hide these so the bubble
 * doesn't show a redundant "📷 Photo" above the photo. Kept in sync with
 * packages/features/.../derive-message-content.ts.
 */
const PLACEHOLDER_LABELS = new Set([
  '📷 Photo',
  '🎥 Video',
  '🎤 Voice message',
  '📎 File',
  '🔗 Shared link',
  '📎 Attachment',
  '[Sticker]',
  '[Message]',
]);

interface MessageMediaItem {
  url: string;
  kind: 'image' | 'sticker';
}

function getRenderableMedia(message: ConversationMessage): MessageMediaItem[] {
  const meta = message.metadata;
  if (!meta || typeof meta !== 'object') return [];
  const items: MessageMediaItem[] = [];
  const attachments = (
    meta as { attachments?: Array<{ type?: string; url?: string }> }
  ).attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a?.url && a.type === 'image')
        items.push({ url: a.url, kind: 'image' });
    }
  }
  const stickerUrl = (meta as { stickerUrl?: string }).stickerUrl;
  if (stickerUrl) items.push({ url: stickerUrl, kind: 'sticker' });
  return items;
}

/**
 * Renders a message body: any image/sticker media, plus the text content —
 * suppressing the auto-generated placeholder label when media is shown, and
 * always falling back to text so a bubble is never blank.
 */
function MessageBody({ message }: MessageBubbleProps) {
  const media = getRenderableMedia(message);
  const content = message.content ?? '';
  const showText =
    content.trim().length > 0 &&
    !(media.length > 0 && PLACEHOLDER_LABELS.has(content.trim()));

  return (
    <div className="space-y-1.5">
      {media.map((m) => (
        <img
          key={m.url}
          src={m.url}
          alt={m.kind === 'sticker' ? 'Sticker' : 'Attachment'}
          className={cn(
            'rounded-md object-contain',
            m.kind === 'sticker' ? 'max-h-24' : 'max-h-60 w-full'
          )}
          loading="lazy"
        />
      ))}
      {showText && <p className="whitespace-pre-wrap">{content}</p>}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isSynced =
    message.role === 'bot' &&
    message.metadata &&
    typeof message.metadata === 'object' &&
    'synced' in message.metadata &&
    (message.metadata as Record<string, unknown>).synced === true;
  const config = roleConfig[message.role] ?? roleConfig.bot;
  const Icon = isSynced ? User : config.icon;
  const label = isSynced ? null : config.label;

  return (
    <Message align={config.align}>
      <MessageAvatar className="size-8">
        <Icon className="size-4 text-muted-foreground" />
      </MessageAvatar>
      <MessageContent>
        <Bubble variant={config.variant} align={config.align}>
          <BubbleContent className="rounded-lg px-3 py-2">
            <MessageBody message={message} />
          </BubbleContent>
        </Bubble>
        <MessageFooter className="px-0.5 text-[10px]">
          {label ? `${label} · ` : ''}
          {format(new Date(message.sentAt ?? message.createdAt), 'HH:mm')}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}
