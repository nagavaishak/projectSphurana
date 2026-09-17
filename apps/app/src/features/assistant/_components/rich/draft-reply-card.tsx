import { apiClient } from '@borradh-workspace/api-client';
import { Check, Edit, Send, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * `DraftReplyCard` — renders a customer-conversation reply DRAFT for the
 * operator to review and send.
 *
 * Q21a (locked decision): Claire-Owner never auto-sends a customer message.
 * The card surfaces the draft + three actions:
 *   - **Send** → POSTs to `conversations/:id/messages` (the existing
 *     operator-send endpoint), then marks the tool output as `approved`
 *     so Claire knows the operator accepted the draft.
 *   - **Edit** → opens an in-place textarea so the operator can revise the
 *     wording before sending (still goes through the same endpoint on send).
 *   - **Discard** → marks the tool output as `rejected` so Claire knows to
 *     suggest something different.
 *
 * The outcome is reported back to Claire as a MESSAGE. It used to be an
 * `addToolOutput({ output: 'approved' })` call, which required the tool to be
 * paused awaiting a browser answer — this one executes on the server and
 * streams an object, so the card's own "already answered" branch compared an
 * object to the string `'approved'` and rendered "Discarded" over a draft
 * nobody had discarded.
 */
interface DraftReplyCardProps {
  conversationId: string;
  draft: string;
  customerName?: string | null;
  platform?: string;
  /** Sends the operator's outcome back into the conversation. */
  onRespond: (text: string) => void;
}

export function DraftReplyCard({
  conversationId,
  draft: initialDraft,
  customerName,
  platform,
  onRespond,
}: DraftReplyCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [discarded, setDiscarded] = useState(false);

  if (discarded) {
    return (
      <Badge variant="destructive" className="gap-1">
        <X className="size-3" />
        Discarded
      </Badge>
    );
  }

  if (sent) {
    return (
      <Badge variant="default" className="gap-1">
        <Check className="size-3" />
        Sent
      </Badge>
    );
  }

  const handleSend = async () => {
    setSending(true);
    try {
      await apiClient.post(`conversations/${conversationId}/messages`, {
        content: draft,
      });
      setSent(true);
      toast.success('Reply sent');
      onRespond('Sent that reply.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send reply';
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const handleDiscard = () => {
    setDiscarded(true);
    onRespond("Don't send that — suggest something different.");
  };

  return (
    <div className="w-full space-y-3 rounded-md border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Draft reply for {customerName ?? 'customer'}
        </span>
        {platform && (
          <Badge variant="outline" className="text-xs">
            {platform.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>

      {/* Body — display or edit */}
      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(3, draft.split('\n').length + 1)}
          className="text-sm"
          aria-label="Edit reply draft"
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{draft}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          className="gap-1.5"
          onClick={handleSend}
          disabled={sending || !draft.trim()}
        >
          <Send className="size-3.5" />
          {sending ? 'Sending...' : 'Send'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setEditing((v) => !v)}
          disabled={sending}
        >
          <Edit className="size-3.5" />
          {editing ? 'Done' : 'Edit'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={handleDiscard}
          disabled={sending}
        >
          <X className="size-3.5" />
          Discard
        </Button>
      </div>
    </div>
  );
}
