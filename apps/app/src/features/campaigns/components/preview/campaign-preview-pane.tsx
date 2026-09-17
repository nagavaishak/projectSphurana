'use client';

import { useState } from 'react';
import type { CampaignChannel } from '../../api/types';
import type { SampleRecipient } from '../../api/types';
import { EmailPreview } from './email-preview';
import { MailMergePager } from './mail-merge-pager';
import { WhatsAppPreview } from './whatsapp-preview';

export interface CampaignPreviewPaneProps {
  /** The active channels to preview (email / whatsapp; sms is out of scope). */
  channels: CampaignChannel[];
  /** The email subject. */
  subject: string;
  /** The email body. */
  body: string;
  /** The WhatsApp message that fills the canonical template's `{{2}}`. */
  whatsappMessage: string;
  /** Real eligible recipients to page through; empty ⇒ generic sample. */
  recipients: SampleRecipient[];
}

/**
 * The live preview pane: one WYSIWYG preview per active channel, all sharing a
 * single mail-merge pager so the ← / → arrows step every channel's preview to
 * the same recipient at once. Updates live as the composer's fields change.
 */
export function CampaignPreviewPane({
  channels,
  subject,
  body,
  whatsappMessage,
  recipients,
}: CampaignPreviewPaneProps) {
  const [index, setIndex] = useState(0);

  // Clamp against the current recipient list (it changes as the segment does).
  const safeIndex =
    recipients.length === 0
      ? 0
      : Math.min(Math.max(index, 0), recipients.length - 1);
  const recipient: SampleRecipient | undefined = recipients[safeIndex];

  const showEmail = channels.includes('email');
  const showWhatsapp = channels.includes('whatsapp');

  return (
    <MailMergePager
      recipients={recipients}
      index={safeIndex}
      onIndex={setIndex}
    >
      <div className="flex flex-col gap-4">
        {showEmail && (
          <EmailPreview subject={subject} body={body} recipient={recipient} />
        )}
        {showWhatsapp && (
          <WhatsAppPreview message={whatsappMessage} recipient={recipient} />
        )}
      </div>
    </MailMergePager>
  );
}
