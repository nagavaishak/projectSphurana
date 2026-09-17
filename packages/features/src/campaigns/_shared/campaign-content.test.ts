import { describe, expect, it } from '@borradh-workspace/testing';
import {
  CANONICAL_WHATSAPP_TEMPLATE,
  type CampaignWhatsappTemplateAtom,
  WHATSAPP_STOP_LINE,
  fillWhatsappTemplate,
  renderCampaignEmailHtml,
  resolveCampaignWhatsappTemplate,
} from './campaign-content.js';

describe('renderCampaignEmailHtml', () => {
  it('escapes HTML-significant characters', () => {
    const html = renderCampaignEmailHtml('New paragraph <b>&');
    expect(html).toContain('New paragraph &lt;b&gt;&amp;');
    expect(html).not.toContain('<b>');
  });

  it('splits blank-line blocks into paragraphs and single newlines into <br/>', () => {
    const html = renderCampaignEmailHtml('Line one\nLine two\n\nNew paragraph');
    expect(html).toContain('Line one<br/>Line two');
    expect((html.match(/<p /g) ?? []).length).toBe(2);
  });

  it('returns an empty container for a blank body', () => {
    expect(renderCampaignEmailHtml('')).toBe('<p style="margin:0"></p>');
  });

  it('omits the unsubscribe footer when no url is given', () => {
    const html = renderCampaignEmailHtml('Hello');
    expect(html).not.toContain('Unsubscribe');
    expect(html).not.toContain('<hr');
  });

  it('appends the exact unsubscribe footer when a url is given', () => {
    const html = renderCampaignEmailHtml('Hello', {
      unsubscribeUrl: 'https://x.test/u/abc',
    });
    expect(html).toContain(
      '<hr style="margin-top:32px;border:none;border-top:1px solid #eee"/>'
    );
    expect(html).toContain(
      `Don't want these emails? <a href="https://x.test/u/abc" style="color:#888">Unsubscribe</a>`
    );
  });
});

describe('CANONICAL_WHATSAPP_TEMPLATE', () => {
  it('uses the canonical name/language/category', () => {
    expect(CANONICAL_WHATSAPP_TEMPLATE.name).toBe('borradh_campaign_message');
    expect(CANONICAL_WHATSAPP_TEMPLATE.languageCode).toBe('en_US');
    expect(CANONICAL_WHATSAPP_TEMPLATE.category).toBe('MARKETING');
  });

  it('always carries the STOP opt-out line', () => {
    expect(CANONICAL_WHATSAPP_TEMPLATE.body).toContain(WHATSAPP_STOP_LINE);
  });

  it('has {{1}} for first name and {{2}} for the message', () => {
    expect(CANONICAL_WHATSAPP_TEMPLATE.body).toContain('{{1}}');
    expect(CANONICAL_WHATSAPP_TEMPLATE.body).toContain('{{2}}');
  });
});

describe('resolveCampaignWhatsappTemplate', () => {
  const canonical: CampaignWhatsappTemplateAtom = {
    id: 't_canonical',
    name: CANONICAL_WHATSAPP_TEMPLATE.name,
    languageCode: CANONICAL_WHATSAPP_TEMPLATE.languageCode,
    status: 'approved',
    body: CANONICAL_WHATSAPP_TEMPLATE.body,
  };
  const other: CampaignWhatsappTemplateAtom = {
    id: 't_other',
    name: 'promo_blast',
    languageCode: 'en_US',
    status: 'approved',
    body: 'Hello {{1}}, grab {{2}} off today. {{3}}',
  };

  it('prefers the canonical template by name and auto-binds {{1}}', () => {
    const resolved = resolveCampaignWhatsappTemplate([other, canonical]);
    expect(resolved?.template.id).toBe('t_canonical');
    expect(resolved?.firstNameParamIndex).toBe(1);
    expect(resolved?.editableParamIndices).toEqual([2]);
  });

  it('falls back to the first approved template when no canonical exists', () => {
    const pending: CampaignWhatsappTemplateAtom = {
      ...other,
      id: 't_pending',
      status: 'pending',
    };
    const resolved = resolveCampaignWhatsappTemplate([pending, other]);
    expect(resolved?.template.id).toBe('t_other');
    expect(resolved?.firstNameParamIndex).toBe(1);
    expect(resolved?.editableParamIndices).toEqual([2, 3]);
  });

  it('returns null when there is no canonical and nothing approved', () => {
    expect(
      resolveCampaignWhatsappTemplate([{ ...other, status: 'pending' }])
    ).toBeNull();
    expect(resolveCampaignWhatsappTemplate([])).toBeNull();
  });
});

describe('fillWhatsappTemplate', () => {
  it('fills params and always preserves the STOP line', () => {
    const filled = fillWhatsappTemplate(CANONICAL_WHATSAPP_TEMPLATE.body, {
      1: 'Ada',
      2: 'Your appointment is confirmed.',
    });
    expect(filled).toBe(
      'Hi Ada,\n\nYour appointment is confirmed.\n\nReply STOP to unsubscribe.'
    );
    expect(filled).toContain(WHATSAPP_STOP_LINE);
  });

  it('keeps the {{n}} token for params with no supplied value', () => {
    const filled = fillWhatsappTemplate('Hi {{1}}, {{2}}', { 1: 'Ada' });
    expect(filled).toBe('Hi Ada, {{2}}');
  });
});
