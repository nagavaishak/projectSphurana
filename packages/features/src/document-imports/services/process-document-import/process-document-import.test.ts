import { chatCompletion, visionCompletion } from '@borradh-workspace/ai';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import type { DocumentMediaDeps } from '../../models/index.js';
import { processDocumentImportJob } from './process-document-import.service.js';

const reply = (fields: Record<string, unknown>) =>
  ({
    content: JSON.stringify({
      documentKind: 'consent_form',
      personName: 'Jane Doe',
      email: null,
      phone: null,
      dateOfBirth: null,
      dates: [],
      summary: 'Consent form',
      legible: true,
      ...fields,
    }),
  }) as never;

describe('processDocumentImportJob', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets'),
    getS3Region: vi.fn().mockReturnValue('eu-west-1'),
    getPresignedUploadUrl: vi.fn(),
    getMetadata: vi.fn(),
    downloadAsBuffer: vi.fn(),
    copy: vi.fn(),
    deleteObject: vi.fn(),
  };
  const media: DocumentMediaDeps = {
    extractPdfText: vi.fn(),
    renderPdfPages: vi.fn(),
    prepareImage: vi.fn(),
  };
  const deps = { storage, media };
  const payload = { organizationId: 'org_1', importId: 'imp_1' };

  const claimed = {
    id: 'imp_1',
    organizationId: 'org_1',
    uploadedByUserId: 'user_1',
    fileName: 'consent.pdf',
    storageKey: 'document-imports/org_1/imp_1/1-abc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 4096,
    status: 'processing',
    patientDocumentId: null,
  };

  const leadRow = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    firstName: 'Jane',
    lastName: 'Doe',
    email: null,
    phone: null,
    whatsapp: null,
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.getS3Region.mockReturnValue('eu-west-1');
    storage.downloadAsBuffer.mockResolvedValue(Buffer.from('%PDF'));
    storage.copy.mockResolvedValue({ etag: 'e' });
    storage.deleteObject.mockResolvedValue(undefined);
    storage.getMetadata.mockResolvedValue({
      key: 'x',
      size: 4096,
      contentType: 'application/pdf',
    });
    vi.mocked(media.extractPdfText).mockResolvedValue('x'.repeat(500));
    mockDb.query.appointment.findMany.mockResolvedValue([]);
  });

  it('skips a row it cannot claim', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('skipped');
    expect(storage.downloadAsBuffer).not.toHaveBeenCalled();
  });

  it('leaves a row discarded mid-flight discarded — no vault file, no failed flip', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]); // claim
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      reply({ email: 'jane@example.com' })
    );
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      leadRow('l_1', { email: 'Jane@Example.com' }),
    ]);
    // Staff discarded while the model was reading: finalize's live-scoped
    // lookup misses.
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(undefined);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('skipped');
    expect(storage.copy).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    // …and nothing rewrote the discarded row back to `failed`.
    expect(
      mockDb.set.mock.calls.some(([values]) => values?.status === 'failed')
    ).toBe(false);
  });

  it('auto-attaches on a single exact email hit without asking the model twice', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]); // claim
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      reply({ email: 'jane@example.com' })
    );
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      leadRow('l_1', { email: 'Jane@Example.com' }),
      leadRow('l_2'), // name-only twin
    ]);
    // finalize: load row, lead∈org for createPatientDocument, insert, update
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(claimed);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l_1',
      organizationId: 'org_1',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'doc_1' }]) // patient_document insert
      .mockResolvedValueOnce([{ ...claimed, status: 'matched' }]); // import update

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('matched');
    expect(chatCompletion).toHaveBeenCalledTimes(1); // extract only
    expect(visionCompletion).not.toHaveBeenCalled();

    expect(storage.copy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBucket: 'org-assets',
        sourceKey: claimed.storageKey,
        destinationBucket: 'org-assets',
        destinationKey: expect.stringMatching(
          /^patient-documents\/org_1\/l_1\/\d+-[0-9a-f]+\.pdf$/
        ),
      })
    );
    const [vaultValues] = mockDb.values.mock.calls[0];
    expect(vaultValues).toMatchObject({
      organizationId: 'org_1',
      leadId: 'l_1',
      uploadedByType: 'staff',
      uploadedByUserId: 'user_1',
      fileName: 'consent.pdf',
    });
    const finalUpdate = mockDb.set.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      status: 'matched',
      matchedLeadId: 'l_1',
      matchSource: 'auto',
      confidence: 0.97,
      patientDocumentId: 'doc_1',
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'org-assets',
      key: claimed.storageKey,
    });
  });

  /**
   * Most clinical paperwork carries a name and nothing else. Requiring an
   * email or phone to corroborate it meant the ordinary consent form could
   * never file itself and landed in review every single time — so a name that
   * fits exactly one client now files on its own, without a second model call.
   */
  it('auto-attaches on a name that fits one client and no other', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      reply({ email: null, phone: null })
    );
    mockDb.query.lead.findMany.mockResolvedValueOnce([leadRow('l_1')]);
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(claimed);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l_1',
      organizationId: 'org_1',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'doc_1' }])
      .mockResolvedValueOnce([{ ...claimed, status: 'matched' }]);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('matched');
    // Extraction only — the adjudicator is not worth a round trip when the
    // name is unambiguous.
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const finalUpdate = mockDb.set.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      status: 'matched',
      matchedLeadId: 'l_1',
      matchSource: 'auto',
      confidence: 0.9,
    });
  });

  it('asks the model to adjudicate name-only twins and parks a low-confidence pick for review', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(reply({})) // extract
      .mockResolvedValueOnce({
        content:
          '{"leadId":"l_1","confidence":0.55,"reason":"Two Jane Does, no contact details"}',
      } as never); // adjudicate
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      leadRow('l_1'),
      leadRow('l_2'),
    ]);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('needs_review');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(storage.copy).not.toHaveBeenCalled();
    const update = mockDb.set.mock.calls.at(-1)?.[0];
    expect(update).toMatchObject({
      status: 'needs_review',
      confidence: 0.55,
      matchReason: 'Two Jane Does, no contact details',
      documentKind: 'consent_form',
    });
    expect(update.candidates).toEqual([
      { leadId: 'l_1', name: 'Jane Doe', matchedOn: ['name'], score: 0.85 },
      { leadId: 'l_2', name: 'Jane Doe', matchedOn: ['name'], score: 0.85 },
    ]);
    // Nothing the model read is dropped on the floor.
    expect(update.extracted).toMatchObject({ personName: 'Jane Doe' });
  });

  it('parks a document nobody matches without calling the adjudicator', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    vi.mocked(chatCompletion).mockResolvedValueOnce(reply({}));
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('needs_review');
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const update = mockDb.set.mock.calls.at(-1)?.[0];
    expect(update).toMatchObject({ status: 'needs_review', candidates: [] });
  });

  it('marks an unreadable file failed and completes the job', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'nope',
    } as never);

    const outcome = await processDocumentImportJob(
      mockDb as never,
      deps,
      payload
    );

    expect(outcome).toBe('failed');
    const update = mockDb.set.mock.calls.at(-1)?.[0];
    expect(update).toMatchObject({
      status: 'failed',
      failureReason: 'The document reader returned no usable answer',
    });
  });

  it('marks the row failed AND rethrows on a model outage so BullMQ retries', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    vi.mocked(chatCompletion).mockRejectedValueOnce(new Error('503'));

    await expect(
      processDocumentImportJob(mockDb as never, deps, payload)
    ).rejects.toThrow(/Document reader unavailable/);

    const update = mockDb.set.mock.calls.at(-1)?.[0];
    expect(update).toMatchObject({ status: 'failed' });
  });
});
