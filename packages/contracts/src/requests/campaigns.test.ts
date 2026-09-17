import { describe, expect, it } from 'vitest';
import {
  createCampaignRequestSchema,
  createSegmentRequestSchema,
  launchCampaignRequestSchema,
  previewSegmentRequestSchema,
  updateCampaignRequestSchema,
  updateSegmentRequestSchema,
  upsertCampaignMessageRequestSchema,
} from './campaigns.js';

// A valid `POST campaigns` body as the composer would send it: no
// server-injected `organizationId` / `createdById`.
const validCampaign = {
  name: 'Message — 3 Feb 2026',
  channels: ['email', 'sms'],
  segmentId: 'seg_1',
};

describe('createCampaignRequestSchema', () => {
  it('accepts a valid campaign-create body', () => {
    expect(createCampaignRequestSchema.safeParse(validCampaign).success).toBe(
      true
    );
  });

  it("MATERIALISES the `type` default into the parsed body ('custom')", () => {
    const parsed = createCampaignRequestSchema.parse(validCampaign);
    expect(parsed.type).toBe('custom');
  });

  it('REJECTS an unknown / extra field (proves .strict())', () => {
    const result = createCampaignRequestSchema.safeParse({
      ...validCampaign,
      // Server-injected — must never appear in a body.
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('rejects an empty `channels` array (a send with no channel is a no-op)', () => {
    expect(
      createCampaignRequestSchema.safeParse({ ...validCampaign, channels: [] })
        .success
    ).toBe(false);
  });

  it('rejects a channel outside the shared labels vocabulary', () => {
    expect(
      createCampaignRequestSchema.safeParse({
        ...validCampaign,
        channels: ['carrier_pigeon'],
      }).success
    ).toBe(false);
  });

  it('rejects a body missing the required `name`', () => {
    const { name: _omit, ...withoutName } = validCampaign;
    expect(createCampaignRequestSchema.safeParse(withoutName).success).toBe(
      false
    );
  });

  it('rejects a non-ISO `scheduledAt` (wire shape is a datetime string)', () => {
    expect(
      createCampaignRequestSchema.safeParse({
        ...validCampaign,
        scheduledAt: 'next tuesday',
      }).success
    ).toBe(false);
  });

  it('rejects a Date object where an ISO string is required', () => {
    expect(
      createCampaignRequestSchema.safeParse({
        ...validCampaign,
        scheduledAt: new Date(),
      }).success
    ).toBe(false);
  });
});

describe('updateCampaignRequestSchema', () => {
  it('accepts an empty body (a PATCH-shaped update touches nothing)', () => {
    expect(updateCampaignRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts `null` to CLEAR the segment / schedule', () => {
    const result = updateCampaignRequestSchema.safeParse({
      segmentId: null,
      scheduledAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS the route param `id` in the body', () => {
    expect(
      updateCampaignRequestSchema.safeParse({ id: 'camp_1', name: 'x' }).success
    ).toBe(false);
  });

  it('rejects `type` — a campaign preset is fixed at creation', () => {
    expect(
      updateCampaignRequestSchema.safeParse({ type: 'gmb_review' }).success
    ).toBe(false);
  });
});

describe('launchCampaignRequestSchema', () => {
  it('accepts the empty body the endpoint actually takes', () => {
    expect(launchCampaignRequestSchema.safeParse({}).success).toBe(true);
  });

  it('REJECTS any field — a silently-ignored key on an irreversible send is the bug this catches', () => {
    expect(
      launchCampaignRequestSchema.safeParse({ testMode: true }).success
    ).toBe(false);
  });
});

describe('createSegmentRequestSchema', () => {
  const validSegment = {
    name: 'Lapsed clients',
    filterJson: { status: ['lost'], consentEmail: true },
  };

  it('accepts a valid segment-create body', () => {
    expect(createSegmentRequestSchema.safeParse(validSegment).success).toBe(
      true
    );
  });

  it('MATERIALISES the `isDynamic` default (true) into the parsed body', () => {
    expect(createSegmentRequestSchema.parse(validSegment).isDynamic).toBe(true);
  });

  it('REJECTS an unknown key INSIDE the nested filter', () => {
    // A filter key the backend does not understand would be persisted and
    // silently ignored at send time — quietly widening a bulk-message audience.
    const result = createSegmentRequestSchema.safeParse({
      ...validSegment,
      filterJson: { status: ['lost'], consentWhatsapp: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO date bound inside the filter', () => {
    expect(
      createSegmentRequestSchema.safeParse({
        ...validSegment,
        filterJson: { createdFrom: '2024-01-01' },
      }).success
    ).toBe(false);
  });

  it('rejects a body missing `filterJson`', () => {
    expect(createSegmentRequestSchema.safeParse({ name: 'x' }).success).toBe(
      false
    );
  });
});

describe('updateSegmentRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(updateSegmentRequestSchema.safeParse({}).success).toBe(true);
  });

  it('does NOT default `isDynamic` (absent means "leave it alone")', () => {
    expect(updateSegmentRequestSchema.parse({})).not.toHaveProperty(
      'isDynamic'
    );
  });

  it('REJECTS the route param `id` in the body', () => {
    expect(updateSegmentRequestSchema.safeParse({ id: 'seg_1' }).success).toBe(
      false
    );
  });
});

describe('previewSegmentRequestSchema', () => {
  it('defaults `channels` to every channel', () => {
    const parsed = previewSegmentRequestSchema.parse({ filterJson: {} });
    expect(parsed.channels).toEqual(['email', 'sms', 'whatsapp']);
  });

  it('REJECTS an unknown / extra field', () => {
    expect(
      previewSegmentRequestSchema.safeParse({
        filterJson: {},
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

describe('upsertCampaignMessageRequestSchema', () => {
  it('accepts an email message with a subject', () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'email',
        subject: 'Spring offers inside',
        body: 'Hi {{firstName|there}} — 20% off this month.',
      }).success
    ).toBe(true);
  });

  it('accepts a WhatsApp template message with ordered params', () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'whatsapp',
        body: 'template body',
        whatsappTemplateId: 'tmpl_1',
        whatsappTemplateParams: ['{{firstName|there}}', 'March'],
      }).success
    ).toBe(true);
  });

  it('rejects an empty body — there is nothing to send', () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'sms',
        body: '',
      }).success
    ).toBe(false);
  });

  it("rejects `mediaUrl: ''` — normalise a blank picker to undefined", () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'whatsapp',
        body: 'hi',
        mediaUrl: '',
      }).success
    ).toBe(false);
  });

  it("rejects more than Meta's 20 template params", () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'whatsapp',
        body: 'hi',
        whatsappTemplateParams: Array.from({ length: 21 }, () => 'x'),
      }).success
    ).toBe(false);
  });

  it('rejects a channel outside the labels vocabulary', () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'carrier_pigeon',
        body: 'hi',
      }).success
    ).toBe(false);
  });

  it('REJECTS the route param `campaignId` and the session `organizationId`', () => {
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'sms',
        body: 'hi',
        campaignId: 'camp_1',
      }).success
    ).toBe(false);
    expect(
      upsertCampaignMessageRequestSchema.safeParse({
        channel: 'sms',
        body: 'hi',
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});
