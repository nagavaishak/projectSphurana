import { chatCompletion, visionCompletion } from '@borradh-workspace/ai';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import type { DocumentMediaDeps } from '../../models/index.js';
import {
  extractDocumentFields,
  parseExtractedDocument,
} from './extract-document-fields.service.js';

const REPLY = JSON.stringify({
  documentKind: 'consent_form',
  personName: 'Jane Doe',
  email: 'Jane.Doe@Example.com',
  phone: '+44 7700 900123',
  dateOfBirth: '1990-01-02',
  dates: ['2026-08-01'],
  summary: 'Signed consent form',
  legible: true,
});

describe('parseExtractedDocument', () => {
  it('accepts fenced JSON and normalises the email', () => {
    const parsed = parseExtractedDocument(`\`\`\`json\n${REPLY}\n\`\`\``);
    expect(parsed).toMatchObject({
      documentKind: 'consent_form',
      personName: 'Jane Doe',
      email: 'jane.doe@example.com',
    });
  });

  it('degrades odd fields to unknown instead of rejecting the document', () => {
    const parsed = parseExtractedDocument(
      '{"documentKind":"receipt","personName":"","email":"not-an-email","dates":"2026"}'
    );
    expect(parsed).toMatchObject({
      documentKind: 'other',
      personName: null,
      email: null,
      dates: [],
      legible: true,
    });
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseExtractedDocument('sorry')).toBeNull();
  });
});

describe('extractDocumentFields', () => {
  const media: DocumentMediaDeps = {
    extractPdfText: vi.fn(),
    renderPdfPages: vi.fn(),
    prepareImage: vi.fn(),
  };
  const base = {
    organizationId: 'org_1',
    importId: 'imp_1',
    fileName: 'consent.pdf',
    bytes: Buffer.from('pdf'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chatCompletion).mockResolvedValue({ content: REPLY } as never);
    vi.mocked(visionCompletion).mockResolvedValue({ content: REPLY } as never);
    vi.mocked(media.prepareImage).mockResolvedValue({
      base64: 'IMG',
      mimeType: 'image/jpeg',
    });
  });

  /**
   * A text layer covers what was TYPED and nothing else — not the ID photo
   * pasted into the form, not the handwriting in the blanks, not the
   * signature. Sending text alone meant those documents were judged on the
   * boilerplate around the very thing identifying the client, so the pages go
   * to vision too and the text rides along.
   */
  it('sends a text-layer PDF to vision WITH its text, so pictures are read too', async () => {
    vi.mocked(media.extractPdfText).mockResolvedValueOnce('x'.repeat(500));
    vi.mocked(media.renderPdfPages).mockResolvedValueOnce([Buffer.from('p1')]);

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'application/pdf',
    });

    expect(result.success).toBe(true);
    expect(media.renderPdfPages).toHaveBeenCalledTimes(1);
    expect(visionCompletion).toHaveBeenCalledTimes(1);
    expect(chatCompletion).not.toHaveBeenCalled();
    const [prompt, images, options] = vi.mocked(visionCompletion).mock.calls[0];
    expect(prompt).toContain('File name: consent.pdf');
    expect(prompt).toContain('Extracted text layer');
    expect(prompt).toMatch(/handwritten, signed, stamped, or photographed/);
    expect(images).toHaveLength(1);
    expect(options).toMatchObject({
      jsonResponse: true,
      reasoningEffort: 'low',
      maxRetries: 1,
      detail: 'high',
      observability: {
        spanName: 'documentImports.extract',
        groups: { organization: 'org_1' },
      },
    });
  });

  it('falls back to text when the pages will not rasterise', async () => {
    vi.mocked(media.extractPdfText).mockResolvedValueOnce('x'.repeat(500));
    vi.mocked(media.renderPdfPages).mockRejectedValueOnce(
      new Error('canvas exploded')
    );

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'application/pdf',
    });

    expect(result.success).toBe(true);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(visionCompletion).not.toHaveBeenCalled();
  });

  it('surfaces a render failure when there is no text to fall back on', async () => {
    vi.mocked(media.extractPdfText).mockResolvedValueOnce('');
    vi.mocked(media.renderPdfPages).mockRejectedValueOnce(
      new Error('Cannot perform Construct on a detached ArrayBuffer')
    );

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'application/pdf',
    });

    expect(result.success).toBe(false);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(visionCompletion).not.toHaveBeenCalled();
  });

  it('rasterises a scanned PDF and sends the pages at high detail', async () => {
    vi.mocked(media.extractPdfText).mockResolvedValueOnce('');
    vi.mocked(media.renderPdfPages).mockResolvedValueOnce([
      Buffer.from('p1'),
      Buffer.from('p2'),
    ]);

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'application/pdf',
    });

    expect(result.success).toBe(true);
    expect(media.renderPdfPages).toHaveBeenCalledWith(base.bytes, {
      maxPages: 3,
      scale: 1.5,
    });
    const [, images, options] = vi.mocked(visionCompletion).mock.calls[0];
    expect(images).toEqual([
      { base64: Buffer.from('p1').toString('base64'), mimeType: 'image/jpeg' },
      { base64: Buffer.from('p2').toString('base64'), mimeType: 'image/jpeg' },
    ]);
    expect(options).toMatchObject({ detail: 'high' });
  });

  it('downscales a photo before sending it', async () => {
    const result = await extractDocumentFields(media, {
      ...base,
      fileName: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.success).toBe(true);
    expect(media.prepareImage).toHaveBeenCalledWith(base.bytes, 'image/jpeg');
    const [, images] = vi.mocked(visionCompletion).mock.calls[0];
    expect(images).toEqual([{ base64: 'IMG', mimeType: 'image/jpeg' }]);
  });

  it('reports an unreadable reply as VALIDATION_ERROR (no retry)', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: '???',
    } as never);
    vi.mocked(media.extractPdfText).mockResolvedValueOnce('x'.repeat(500));

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'application/pdf',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('reports a model outage as EXTERNAL_SERVICE_ERROR (retry)', async () => {
    vi.mocked(visionCompletion).mockRejectedValueOnce(
      new Error('Request timed out')
    );

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'image/png',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('reports a broken file as VALIDATION_ERROR (no retry)', async () => {
    vi.mocked(media.prepareImage).mockRejectedValueOnce(
      new Error('Input buffer contains unsupported image format')
    );

    const result = await extractDocumentFields(media, {
      ...base,
      mimeType: 'image/png',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
