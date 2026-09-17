import { Link } from '@tanstack/react-router';
import { Brain } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface MemoryRecallBadgePayload {
  knowledgeEntryId: string;
  content: string;
  scope: 'personal' | 'organization';
}

export interface MemoryRecallBadgeProps {
  payload: MemoryRecallBadgePayload;
}

/**
 * Inline "Claire remembered…" chip rendered below an assistant message
 * when its response was informed by a `preference` knowledge entry.
 *
 * **Gated on backend emit (W-C14-frontend, 2026-04-26).** As of v3
 * launch the controller does NOT emit a `memory_recalled` part: the
 * `queryKnowledge` results are folded into the system prompt's knowledge
 * block server-side with no wire-level signal. The component is shipped
 * now so a follow-up window only needs to wire the emit side
 * (`writeData()` from `assistant-chat.controller.ts`) and the chip
 * lights up automatically. See `message-list.tsx` for the part-type
 * recognition gate that drives this.
 *
 * Tone: small ghost-styled chip, Irish-warm copy ("Claire remembered…"),
 * doesn't dominate the message body.
 */
export function MemoryRecallBadge({ payload }: MemoryRecallBadgeProps) {
  const [open, setOpen] = useState(false);

  // Trim long memories for the chip; the dialog shows the full text.
  const previewLength = 60;
  const preview =
    payload.content.length > previewLength
      ? `${payload.content.slice(0, previewLength).trim()}…`
      : payload.content;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1.5 text-left"
        aria-label="View memory Claire used in this answer"
      >
        <Badge
          variant="outline"
          className="text-muted-foreground hover:bg-muted gap-1.5 font-normal"
        >
          <Brain className="size-3" />
          <span className="font-medium">Claire remembered:</span>
          <span className="truncate">{preview}</span>
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Claire remembered this</DialogTitle>
            <DialogDescription>
              {payload.scope === 'personal'
                ? 'Stored just for you. You can edit or remove it any time.'
                : 'Stored for the whole team. Anyone in the org sees it.'}
            </DialogDescription>
          </DialogHeader>

          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {payload.content}
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button asChild>
              <Link to="/settings/claire/memories">Edit in settings</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
