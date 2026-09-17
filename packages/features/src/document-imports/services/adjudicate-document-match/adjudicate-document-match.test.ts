import { chatCompletion } from '@borradh-workspace/ai';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import type { ExtractedDocument, LeadCandidate } from '../../models/index.js';
import {
  adjudicateDocumentMatch,
  buildAdjudicateUserPrompt,
} from './adjudicate-document-match.service.js';

const extracted: ExtractedDocument = {
  documentKind: 'consent_form',
  personName: 'Jane Doe',
  email: 'jane@example.com',
  phone: null,
  dateOfBirth: null,
  dates: ['2026-08-01'],
  summary: 'Signed consent for laser treatment',
  legible: true,
};

const candidates: LeadCandidate[] = [
  {
    leadId: 'l_1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+447700900123',
    matchedOn: ['name'],
    score: 0.6,
    lastAppointments: ['2026-08-01'],
  },
  {
    leadId: 'l_2',
    name: 'Jane Doe',
    email: 'jd@other.com',
    phone: null,
    matchedOn: ['name'],
    score: 0.6,
    lastAppointments: [],
  },
];

const input = {
  organizationId: 'org_1',
  importId: 'imp_1',
  fileName: 'consent.pdf',
  extracted,
  candidates,
};

describe('adjudicateDocumentMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('masks candidate contact details in the prompt', () => {
    const prompt = buildAdjudicateUserPrompt(
      'consent.pdf',
      extracted,
      candidates
    );
    expect(prompt).not.toContain('+447700900123');
    expect(prompt).toContain('…0123');
    expect(prompt).toContain('ja…@example.com');
  });

  it('returns the model’s pick when it is one of the candidates', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content:
        '{"leadId":"l_1","confidence":0.91,"reason":"Same email and an appointment on the signing date"}',
    } as never);

    const result = await adjudicateDocumentMatch(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        leadId: 'l_1',
        confidence: 0.91,
        reason: 'Same email and an appointment on the signing date',
      });
    }
    const [, options] = vi.mocked(chatCompletion).mock.calls[0];
    expect(options).toMatchObject({
      jsonResponse: true,
      maxRetries: 1,
      observability: { spanName: 'documentImports.adjudicate' },
    });
  });

  it('treats an id outside the candidate set as no pick', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: '{"leadId":"l_999","confidence":0.99,"reason":"made up"}',
    } as never);

    const result = await adjudicateDocumentMatch(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadId).toBeNull();
      expect(result.data.confidence).toBe(0);
    }
  });

  it('treats an unparseable reply as no pick rather than a failure', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'I cannot decide',
    } as never);

    const result = await adjudicateDocumentMatch(input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leadId).toBeNull();
  });

  it('surfaces a model outage as EXTERNAL_SERVICE_ERROR so the job retries', async () => {
    vi.mocked(chatCompletion).mockRejectedValueOnce(new Error('502'));

    const result = await adjudicateDocumentMatch(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('skips the model entirely with no candidates', async () => {
    const result = await adjudicateDocumentMatch({ ...input, candidates: [] });

    expect(result.success).toBe(true);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
