import { renderCampaignEmailHtml } from '@borradh-workspace/api-client';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SampleRecipient } from '../../api/types';
import { CampaignPreviewPane } from './campaign-preview-pane';
import { EmailPreview } from './email-preview';
import { mergeResolve } from './merge-resolve';

const alice: SampleRecipient = {
  leadId: 'a',
  firstName: 'Alice',
  email: 'alice@example.com',
  phone: null,
  whatsapp: '+100',
};
const bob: SampleRecipient = {
  leadId: 'b',
  firstName: 'Bob',
  email: 'bob@example.com',
  phone: null,
  whatsapp: '+200',
};

describe('EmailPreview', () => {
  it('embeds the exact HTML the sender converter produces (parity)', () => {
    const body = 'Hi {{firstName|there}},\n\nWelcome aboard.\n\nCheers';
    render(<EmailPreview subject="Hello" body={body} recipient={alice} />);

    const iframe = screen.getByTitle('Email preview');
    const srcDoc = iframe.getAttribute('srcdoc') ?? '';

    // The preview must contain byte-for-byte what renderCampaignEmailHtml emits
    // for the recipient-resolved body — this is the preview==delivery guarantee.
    const expected = renderCampaignEmailHtml(mergeResolve(body, alice), {
      unsubscribeUrl: '#',
    });
    expect(srcDoc).toContain(expected);
    // Sanity: it really is the <p> HTML, personalized, with the opt-out footer.
    expect(expected).toContain('<p style="margin:0 0 16px');
    expect(srcDoc).toContain('Hi Alice,');
    expect(srcDoc).toContain('Unsubscribe');
  });
});

describe('CampaignPreviewPane mail-merge paging', () => {
  it('changes the rendered first name when paging recipients', () => {
    render(
      <CampaignPreviewPane
        channels={['whatsapp']}
        subject=""
        body=""
        whatsappMessage="Your appointment is confirmed."
        recipients={[alice, bob]}
      />
    );

    expect(screen.getByText(/Hi Alice,/)).toBeTruthy();
    expect(screen.getByText(/Recipient 1 of 2/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next recipient' }));

    expect(screen.getByText(/Hi Bob,/)).toBeTruthy();
    expect(screen.getByText(/Recipient 2 of 2/)).toBeTruthy();
  });
});
