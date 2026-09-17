import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameWithTimestamp } from '../ffmpeg/types.js';
import type { VideoAnalysisContext } from './types.js';

// Mock OpenAI — must return a nested object with `chat.completions.create`
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

import {
  EmptyVisionResponseError,
  analyzeFrames,
  analyzeFramesWithSegments,
  classifyContent,
  initVisionApi,
} from './vision-analysis.service.js';

/**
 * Write a throwaway frame file and return its path plus a cleanup fn.
 */
function makeFrame(): { path: string; cleanup: () => void } {
  const dir = `/tmp/vision-test-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(dir, { recursive: true });
  const framePath = `${dir}/frame_01.jpg`;
  fs.writeFileSync(framePath, Buffer.from('fake-jpeg-data'));
  return {
    path: framePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const baseContext: VideoAnalysisContext = {
  businessType: 'beauty salon',
  organizationServices: ['haircut', 'facial'],
};

const validResponse = JSON.stringify({
  contentType: 'procedure',
  description: 'A haircut in progress',
  matchedServices: [{ serviceName: 'haircut', confidence: 0.9 }],
  suggestedTags: ['haircut', 'close-up'],
  qualityScore: 0.8,
  qualityFlags: {
    isShaky: false,
    isBlurry: false,
    isPoorLighting: false,
    showsOnlyEquipment: false,
    isTooShort: false,
  },
});

describe('vision-analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Zero out retry backoff so retry tests run instantly.
    vi.stubEnv('VISION_RETRY_BASE_DELAY_MS', '0');
    initVisionApi({ apiKey: 'test-key', model: 'gpt-4o' });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: validResponse } }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('analyzeFrames', () => {
    it('throws when all frame files are missing', async () => {
      await expect(
        analyzeFrames(['/tmp/nonexistent-frame.jpg'], baseContext)
      ).rejects.toThrow('No readable frame files found');
    });

    it('throws when frame list is empty', async () => {
      await expect(analyzeFrames([], baseContext)).rejects.toThrow(
        'No frames provided for analysis'
      );
    });

    it('skips missing frames and succeeds with remaining ones', async () => {
      const tmpDir = `/tmp/vision-test-analyze-${Date.now()}`;
      fs.mkdirSync(tmpDir, { recursive: true });
      const existingFrame = `${tmpDir}/frame_01.jpg`;
      fs.writeFileSync(existingFrame, Buffer.from('fake-jpeg-data'));

      const result = await analyzeFrames(
        ['/tmp/nonexistent.jpg', existingFrame],
        baseContext
      );

      expect(result.contentType).toBe('procedure');

      // Cleanup
      fs.unlinkSync(existingFrame);
      fs.rmdirSync(tmpDir);
    });
  });

  describe('analyzeFramesWithSegments', () => {
    it('throws when all frame files are missing', async () => {
      const frames: FrameWithTimestamp[] = [
        { path: '/tmp/nonexistent-frame-001.jpg', timestampSec: 0 },
        { path: '/tmp/nonexistent-frame-002.jpg', timestampSec: 5 },
      ];

      await expect(
        analyzeFramesWithSegments(frames, baseContext, 10)
      ).rejects.toThrow('No readable frame files found');
    });

    it('throws when frames array is empty', async () => {
      await expect(
        analyzeFramesWithSegments([], baseContext, 10)
      ).rejects.toThrow('No frames provided for analysis');
    });

    it('succeeds when frame files exist', async () => {
      const tmpDir = `/tmp/vision-test-${Date.now()}`;
      fs.mkdirSync(tmpDir, { recursive: true });
      const framePath = `${tmpDir}/frame_01.jpg`;
      fs.writeFileSync(framePath, Buffer.from('fake-jpeg-data'));

      const frames: FrameWithTimestamp[] = [
        { path: framePath, timestampSec: 0 },
      ];

      const result = await analyzeFramesWithSegments(frames, baseContext, 10);

      expect(result.contentType).toBe('procedure');
      expect(result.description).toBe('A haircut in progress');

      // Cleanup
      fs.unlinkSync(framePath);
      fs.rmdirSync(tmpDir);
    });

    it('skips missing frames and succeeds with remaining ones', async () => {
      const tmpDir = `/tmp/vision-test-mixed-${Date.now()}`;
      fs.mkdirSync(tmpDir, { recursive: true });
      const existingFrame = `${tmpDir}/frame_01.jpg`;
      fs.writeFileSync(existingFrame, Buffer.from('fake-jpeg-data'));

      const frames: FrameWithTimestamp[] = [
        { path: existingFrame, timestampSec: 0 },
        { path: `${tmpDir}/missing_frame.jpg`, timestampSec: 5 },
      ];

      const result = await analyzeFramesWithSegments(frames, baseContext, 10);

      expect(result.contentType).toBe('procedure');

      // Cleanup
      fs.unlinkSync(existingFrame);
      fs.rmdirSync(tmpDir);
    });
  });

  describe('retry behavior', () => {
    it('retries on empty content and succeeds on a later attempt', async () => {
      const frame = makeFrame();
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
        .mockResolvedValueOnce({
          choices: [{ message: { content: validResponse } }],
        });

      const result = await analyzeFrames([frame.path], baseContext);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.contentType).toBe('procedure');
      frame.cleanup();
    });

    it('throws EmptyVisionResponseError after exhausting retries', async () => {
      const frame = makeFrame();
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: null }, finish_reason: 'content_filter' },
        ],
      });

      await expect(analyzeFrames([frame.path], baseContext)).rejects.toThrow(
        EmptyVisionResponseError
      );
      // initial attempt + 2 retries
      expect(mockCreate).toHaveBeenCalledTimes(3);
      frame.cleanup();
    });

    it('bumps max_tokens when truncated (finish_reason: length)', async () => {
      const frame = makeFrame();
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: validResponse } }],
        });

      const result = await analyzeFrames([frame.path], baseContext);

      expect(result.contentType).toBe('procedure');
      const firstMaxTokens = mockCreate.mock.calls[0][0].max_tokens;
      const secondMaxTokens = mockCreate.mock.calls[1][0].max_tokens;
      expect(secondMaxTokens).toBe(firstMaxTokens * 2);
      frame.cleanup();
    });

    it('retries transient errors (429/5xx)', async () => {
      const frame = makeFrame();
      const rateLimit = Object.assign(new Error('rate limited'), {
        status: 429,
      });
      mockCreate.mockRejectedValueOnce(rateLimit).mockResolvedValueOnce({
        choices: [{ message: { content: validResponse } }],
      });

      const result = await analyzeFrames([frame.path], baseContext);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.contentType).toBe('procedure');
      frame.cleanup();
    });

    it('does not retry permanent client errors (400)', async () => {
      const frame = makeFrame();
      const badRequest = Object.assign(new Error('invalid image'), {
        status: 400,
      });
      mockCreate.mockRejectedValue(badRequest);

      await expect(analyzeFrames([frame.path], baseContext)).rejects.toThrow(
        'invalid image'
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
      frame.cleanup();
    });
  });

  describe('classifyContent', () => {
    it('throws when frame file does not exist', async () => {
      await expect(
        classifyContent(['/tmp/nonexistent-classify.jpg'])
      ).rejects.toThrow('Frame file not found');
    });

    it('throws when frame list is empty', async () => {
      await expect(classifyContent([])).rejects.toThrow(
        'No frames provided for classification'
      );
    });
  });
});
