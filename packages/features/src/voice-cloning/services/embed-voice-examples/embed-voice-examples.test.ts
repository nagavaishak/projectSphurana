import { drizzleFkViolation } from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as embedModule from '../../../assistant/knowledge/embed.js';
import { ErrorCodes } from '../../../shared/index.js';
import { embedVoiceExamples } from './embed-voice-examples.service.js';

// The features suite runs `isolate: false`, so a file-local `vi.mock` of an
// internal module persists on the shared worker graph and races other files
// that import the real module. Use a restored `vi.spyOn` per the config's
// maintenance rule instead.
let mockGenerateEmbeddings: MockInstance;

const mockDb = {
  insert: vi.fn(() => ({ values: vi.fn() })),
};

const validInput = {
  organizationId: 'org-1',
  metaAdsPageId: 'page-1',
  messagePairs: [
    { customerMessage: 'How much is a facial?', businessReply: 'From £80.' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateEmbeddings = vi.spyOn(embedModule, 'generateEmbeddings');
  mockGenerateEmbeddings.mockResolvedValue([[0.1, 0.2, 0.3]]);
});

afterEach(() => {
  mockGenerateEmbeddings.mockRestore();
});

describe('embedVoiceExamples', () => {
  it('embeds and inserts the batch', async () => {
    const result = await embedVoiceExamples(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ embeddedCount: 1 });
  });

  it('returns an empty result for no message pairs without embedding', async () => {
    const result = await embedVoiceExamples(mockDb as never, {
      ...validInput,
      messagePairs: [],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ embeddedCount: 0 });
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  // The Page this batch points at was deleted concurrently. drizzle wraps the
  // postgres.js error — the constraint lives on the `.cause` chain, not
  // `error.message` (see isForeignKeyViolation, ENG-844).
  it('returns VALIDATION_ERROR when the Meta Ads Page no longer exists', async () => {
    const insertValues = vi
      .fn()
      .mockRejectedValueOnce(
        drizzleFkViolation(
          'voice_embedding_meta_ads_page_id_meta_ads_page_id_fk'
        )
      );
    mockDb.insert.mockReturnValueOnce({ values: insertValues });

    const result = await embedVoiceExamples(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when the organization no longer exists', async () => {
    const insertValues = vi
      .fn()
      .mockRejectedValueOnce(
        drizzleFkViolation('voice_embedding_organization_id_organization_id_fk')
      );
    mockDb.insert.mockReturnValueOnce({ values: insertValues });

    const result = await embedVoiceExamples(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on an unrelated insert failure', async () => {
    const insertValues = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'));
    mockDb.insert.mockReturnValueOnce({ values: insertValues });

    const result = await embedVoiceExamples(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
