import { createAnthropicClient } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import { vi } from 'vitest';

const mockMessagesCreate = vi.fn();

import { inspectGraphic } from './inspect-graphic.service.js';

const png = async () =>
  await sharp({
    create: {
      width: 400,
      height: 500,
      channels: 3,
      background: { r: 10, g: 120, b: 90 },
    },
  })
    .png()
    .toBuffer();

describe('inspectGraphic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnthropicClient).mockReturnValue({
      messages: { create: mockMessagesCreate },
    } as never);
  });

  it('uses provider-enforced JSON output instead of relying on prompt-only JSON', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"pass":true,"issues":[]}' }],
    });

    const result = await inspectGraphic({
      png: await png(),
      allowAiImages: false,
      expectLogo: false,
    });

    expect(result.success).toBe(true);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: {
          format: expect.objectContaining({
            type: 'json_schema',
            schema: expect.objectContaining({
              required: ['pass', 'issues'],
            }),
          }),
        },
      })
    );
  });
});
