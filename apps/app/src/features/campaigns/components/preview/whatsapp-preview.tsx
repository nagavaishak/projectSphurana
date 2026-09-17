'use client';

import {
  CANONICAL_WHATSAPP_TEMPLATE,
  fillWhatsappTemplate,
} from '@borradh-workspace/api-client';
import { CheckCheckIcon } from 'lucide-react';
import type { SampleRecipient } from '../../api/types';
import { mergeResolve } from './merge-resolve';

export interface WhatsAppPreviewProps {
  /** The user-authored message that fills the template's `{{2}}` field. */
  message: string;
  /** The recipient whose first name fills `{{1}}` (optional → generic sample). */
  recipient?: SampleRecipient;
}

/**
 * Render a WhatsApp-styled chat bubble showing exactly what the recipient will
 * receive: the canonical `borradh_campaign_message` template with `{{1}}` bound
 * to the first name and `{{2}}` bound to the authored message. The mandatory
 * `Reply STOP to unsubscribe.` line is part of the template body, so it is
 * always shown — it can never be edited away (a hard compliance gate).
 */
export function WhatsAppPreview({ message, recipient }: WhatsAppPreviewProps) {
  const firstName = mergeResolve('{{firstName|there}}', recipient);
  const filled = fillWhatsappTemplate(CANONICAL_WHATSAPP_TEMPLATE.body, {
    1: firstName,
    2: mergeResolve(message, recipient),
  });

  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="rounded-lg border p-4 shadow-sm"
      style={{ backgroundColor: '#e5ddd5' }}
    >
      <div className="flex justify-end">
        <div
          className="relative max-w-[85%] rounded-lg px-3 py-2 text-sm text-[#111b21] shadow-sm"
          style={{ backgroundColor: '#d9fdd3' }}
        >
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {filled}
          </p>
          <div className="mt-1 flex items-center justify-end gap-1 text-[#667781] text-[11px]">
            <span>{time}</span>
            <CheckCheckIcon className="size-3.5 text-[#53bdeb]" />
          </div>
        </div>
      </div>
    </div>
  );
}
