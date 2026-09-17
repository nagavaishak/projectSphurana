import { Check, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export interface ConfirmationRequiredPresentation {
  type: 'confirmation_required';
  action: string;
  summary?: { title?: string; fields?: { label: string; value: string }[] };
  /**
   * The verb on the button — "Launch", "Pause", "Render".
   *
   * A button that says "Confirm" makes the owner re-read the card to find out
   * what they are confirming. Naming the action costs nothing and is the last
   * thing they see before spending money.
   */
  confirmLabel?: string;
}

/**
 * The card for a destructive action the factory wants confirmed.
 *
 * WHY THIS IS GENERIC. The tool factory already returns a
 * `confirmation_required` presentation for EVERY destructive tool — the
 * summary, the action, the token — and the app rendered none of it. Confirming
 * happened in prose: Claire described what she was about to do, the owner
 * typed yes, and she called again with the token. That works, but it means the
 * one moment where something irreversible is about to happen looks exactly like
 * every other paragraph in the chat.
 *
 * Dispatching on the ENVELOPE rather than the tool name is the point. The
 * alternative — a branch per tool, as `queueVideoExport` and the `confirm*`
 * tools each have — is why `regenerateItem` shipped with Claire announcing
 * "confirm on the card above" over a card that did not exist. Every future
 * destructive tool gets this one for free.
 *
 * Approving SENDS A MESSAGE rather than calling the tool directly. The second
 * call has to carry the confirmation token, and the model is what holds it —
 * the same reason the clip editor stages on the server rather than in React.
 */
export function ConfirmationRequiredCard({
  presentation,
  onConfirm,
}: {
  presentation: ConfirmationRequiredPresentation;
  /** Sends the owner's answer back into the conversation. */
  onConfirm: (text: string) => void;
}) {
  const [answered, setAnswered] = useState<'yes' | 'no' | null>(null);
  const { summary } = presentation;

  return (
    <div className="w-full rounded-xl border bg-card p-3 sm:max-w-lg">
      <p className="text-sm font-medium">
        {summary?.title ?? 'Confirm this action?'}
      </p>

      {summary?.fields?.length ? (
        <dl className="mt-2 space-y-1">
          {summary.fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <dt className="shrink-0 text-muted-foreground">{field.label}</dt>
              <dd className="truncate text-right">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {answered ? (
        // Spent, not unmounted — the same rule the approval cards follow. A
        // control that vanishes on click takes the only acknowledgement with it.
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {answered === 'yes' ? (
            <>
              <Check className="size-3 text-primary" />
              Confirmed.
            </>
          ) : (
            <>
              <X className="size-3" />
              Cancelled.
            </>
          )}
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              setAnswered('no');
              onConfirm("No — don't do that.");
            }}
          >
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              setAnswered('yes');
              onConfirm('Yes, go ahead.');
            }}
          >
            <Check className="size-3.5" />
            {presentation.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      )}
    </div>
  );
}
