import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { resolveLeadEnquiry } from './resolve-lead-enquiry.js';

// Exercises the real findExistingLead against a mocked db (no module mock, so
// it's robust to the shared test-setup's mock restoration).
const mockDb = {
  query: {
    lead: { findFirst: vi.fn() },
    leadForm: { findFirst: vi.fn() },
    organizationService: { findFirst: vi.fn() },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

const conv = {
  id: 'conv-1',
  organizationId: 'org-1',
  platform: 'whatsapp' as const,
  externalUserId: '353871234567',
  metadata: { leadId: 'lead-1' },
};

describe('resolveLeadEnquiry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('summarises form answers and resolves the mapped service', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      source: 'meta_lead_form',
      formData: {
        form_id: 'F1',
        ad_id: '123',
        email: 'someone@example.com',
        'when_would_you_like_to_come_in_for_the_japanese_head_spa?':
          'the_next_available_appointment',
      },
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      name: 'Japanese Head Spa — New Client Form',
      organizationServiceId: 'svc-jhs',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      name: 'Japanese Head Spa',
      isActive: true,
    });

    const result = await resolveLeadEnquiry(mockDb as never, conv);

    expect(result?.leadId).toBe('lead-1');
    expect(result?.serviceName).toBe('Japanese Head Spa');
    // Question key is humanised; contact + system keys are excluded.
    expect(result?.enquiryText).toContain(
      'when would you like to come in for the japanese head spa'
    );
    expect(result?.enquiryText).toContain('the next available appointment');
    expect(result?.enquiryText).not.toContain('someone@example.com');
    expect(result?.enquiryText).not.toContain('ad_id');
  });

  it('late-links via phone when no leadId is stored, and persists the link', async () => {
    const convNoLead = { ...conv, metadata: { phone: '353871234567' } };
    // No stored leadId → resolveLeadEnquiry calls findExistingLead, whose
    // db.query.lead.findFirst returns the matched lead-form lead.
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-late',
      source: 'meta_lead_form',
      formData: { form_id: 'F2', treatment_timing: 'asap' },
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    const result = await resolveLeadEnquiry(mockDb as never, convNoLead);

    expect(result?.leadId).toBe('lead-late');
    expect(result?.enquiryText).toContain('treatment timing: asap');
    // Persists the discovered link.
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns null when no lead can be found', async () => {
    const convNoLead = { ...conv, metadata: {} };
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await resolveLeadEnquiry(mockDb as never, convNoLead);
    expect(result).toBeNull();
  });

  it('returns null when the lead carries no enquiry or service', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      source: 'whatsapp',
      formData: null,
    });

    const result = await resolveLeadEnquiry(mockDb as never, conv);
    expect(result).toBeNull();
  });
});
