'use client';

import { renderCampaignEmailHtml } from '@borradh-workspace/api-client';
import { useMemo } from 'react';
import type { SampleRecipient } from '../../api/types';
import { mergeResolve } from './merge-resolve';

export interface EmailPreviewProps {
  /** The email subject line, shown as the email header. */
  subject: string;
  /** The plain-text email body the user authored (may contain merge tokens). */
  body: string;
  /** The recipient whose merge fields personalize the preview (optional). */
  recipient?: SampleRecipient;
}

/**
 * Render a realistic WYSIWYG email preview. The body is converted to HTML with
 * the SAME `renderCampaignEmailHtml` converter the sender uses, so the preview
 * is byte-for-byte what gets delivered, and shown inside a fully sandboxed
 * `<iframe srcDoc>` (`sandbox=""` — no scripts, no same-origin) so authored
 * content can never run. The one-click unsubscribe footer is always included.
 */
export function EmailPreview({ subject, body, recipient }: EmailPreviewProps) {
  const resolvedSubject = mergeResolve(subject, recipient);
  const bodyHtml = useMemo(
    () =>
      renderCampaignEmailHtml(mergeResolve(body, recipient), {
        unsubscribeUrl: '#',
      }),
    [body, recipient]
  );

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#ffffff;padding:24px;font-size:15px}a{color:#2563eb}</style></head><body>${bodyHtml}</body></html>`;

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b bg-muted/40 px-4 py-3">
        <p className="text-muted-foreground text-xs">Subject</p>
        <p className="truncate font-medium text-sm" title={resolvedSubject}>
          {resolvedSubject || (
            <span className="text-muted-foreground italic">No subject</span>
          )}
        </p>
      </div>
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={srcDoc}
        className="h-80 w-full border-0 bg-white"
      />
    </div>
  );
}
