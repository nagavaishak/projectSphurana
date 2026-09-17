import {
  MessageCircleOff,
  MessageCircleReply,
  ShieldAlert,
} from 'lucide-react';

/** `confirmation_required` presentation emitted by `chatbots_setEnabled`. */
export interface ChatbotToggleConfirmationPayload {
  type: 'confirmation_required';
  summary?: {
    title?: string;
    fields?: Array<{ label: string; value: string }>;
  };
}

/** Executed-result data shape of `chatbots_setEnabled`. */
export interface ChatbotToggleResultData {
  channel?: string;
  targetId?: string | null;
  targetLabel?: string;
  /** The PERSISTED flag read back from the toggle endpoint. */
  enabled?: boolean;
}

function isConfirmationPayload(
  value: unknown
): value is ChatbotToggleConfirmationPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'confirmation_required'
  );
}

/**
 * Card states for the chatbot kill switch (`chatbots_setEnabled`,
 * Claire reliability overhaul Phase 8 / finding #65):
 *
 *   1. Confirmation pending — the factory issued a token; show what is about
 *      to be switched. Approval happens IN CHAT (the owner replies), so the
 *      card is informational, not a button.
 *   2. Executed — show the PERSISTED state the toggle endpoint reported.
 *
 * Returns null when the output matches neither shape (the chain-of-thought
 * trace covers errors).
 */
export function ChatbotToggleCard({ output }: { output: unknown }) {
  if (!output || typeof output !== 'object') return null;

  const presentation = (output as { presentation?: unknown }).presentation;
  if (isConfirmationPayload(presentation)) {
    const title = presentation.summary?.title ?? 'Change chatbot state';
    const fields = presentation.summary?.fields ?? [];
    return (
      <div className="w-full rounded-lg border bg-card p-4 sm:max-w-sm">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-500" />
          {title}
        </div>
        {fields.length > 0 && (
          <dl className="mt-3 space-y-1.5">
            {fields.map((field) => (
              <div
                key={field.label}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <dt className="text-muted-foreground shrink-0">
                  {field.label}
                </dt>
                <dd className="truncate font-medium text-right">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Reply in chat to approve or cancel.
        </p>
      </div>
    );
  }

  const data = output as ChatbotToggleResultData;
  if (typeof data.enabled !== 'boolean' || !data.targetLabel) return null;

  const Icon = data.enabled ? MessageCircleReply : MessageCircleOff;
  const iconClass = data.enabled
    ? 'size-4 text-emerald-600 dark:text-emerald-500'
    : 'size-4 text-muted-foreground';

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className={iconClass} />
        Chatbot {data.enabled ? 'ON' : 'OFF'} — {data.targetLabel}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {data.enabled
          ? 'The chatbot is replying to customers on this channel.'
          : 'The chatbot has stopped replying on this channel. Incoming messages wait for you.'}
      </p>
    </div>
  );
}
