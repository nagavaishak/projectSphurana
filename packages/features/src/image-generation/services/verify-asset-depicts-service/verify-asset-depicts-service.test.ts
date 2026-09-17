import { createAnthropicClient } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import { vi } from 'vitest';

const mockMessagesCreate = vi.fn();

import { verifyAssetDepictsService } from './verify-asset-depicts-service.service.js';

const reply = (text: string) => ({ content: [{ type: 'text', text }] });
const png = async () =>
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 90, g: 60, b: 30 },
    },
  })
    .png()
    .toBuffer();

const input = async () => ({
  image: await png(),
  serviceName: 'Deep Steam Facial 60 Mins',
});

describe('verifyAssetDepictsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnthropicClient).mockReturnValue({
      messages: { create: mockMessagesCreate },
    } as never);
  });

  it('rejects a photo of a different treatment', async () => {
    // The case it exists for: a coffee-scrub clip filed under a steam facial,
    // which the tagging classifier scored 0.8 — its highest of three services.
    mockMessagesCreate.mockResolvedValueOnce(
      reply('{"depicts":false,"note":"coffee scrub exfoliation, not steam"}')
    );
    const r = await verifyAssetDepictsService(await input());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.depicts).toBe(false);
      expect(r.data.note).toContain('coffee');
    }
  });

  it('accepts an on-topic photo', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      reply('{"depicts":true,"note":"steam facial in progress"}')
    );
    const r = await verifyAssetDepictsService(await input());
    if (r.success) expect(r.data.depicts).toBe(true);
  });

  it('treats a missing or malformed verdict as depicting', async () => {
    // Only an explicit `false` may discard the business's own photograph.
    mockMessagesCreate.mockResolvedValueOnce(reply('{"note":"unclear"}'));
    const r = await verifyAssetDepictsService(await input());
    if (r.success) expect(r.data.depicts).toBe(true);
  });

  it('returns err — not a rejection — when the reply has no JSON', async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply('I cannot tell.'));
    const r = await verifyAssetDepictsService(await input());
    expect(r.success).toBe(false);
  });

  it('returns err when the model call throws', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('502'));
    const r = await verifyAssetDepictsService(await input());
    expect(r.success).toBe(false);
  });
});
