import { describe, expect, it } from '@borradh-workspace/testing';
import {
  DEFAULT_BATCH_GRAPHIC_COUNT,
  DEFAULT_BATCH_VIDEO_COUNT,
  generateMonthlyBatchSchema,
} from './generate-monthly-batch.schema.js';

// The product mix. It is asserted here rather than left implicit because the
// two counts are also mirrored in the frontend dialog
// (`create-batch-dialog.tsx`) — if someone moves one number, this test is what
// tells them the other one exists. `NODE_ENV` is `test` under vitest, which
// takes the non-development branch, i.e. the real production numbers.
describe('generateMonthlyBatchSchema modality defaults', () => {
  it('is graphic-heavy: six graphics, two videos', () => {
    expect(DEFAULT_BATCH_GRAPHIC_COUNT).toBe(6);
    expect(DEFAULT_BATCH_VIDEO_COUNT).toBe(2);
  });

  it('applies those counts when the caller omits them', () => {
    const parsed = generateMonthlyBatchSchema.safeParse({
      organizationId: 'org_1',
      createdById: 'user_1',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.graphicCount).toBe(6);
      expect(parsed.data.videoCount).toBe(2);
    }
  });

  it('still lets a caller ask for a different mix', () => {
    const parsed = generateMonthlyBatchSchema.safeParse({
      organizationId: 'org_1',
      createdById: 'user_1',
      graphicCount: 1,
      videoCount: 1,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.graphicCount).toBe(1);
      expect(parsed.data.videoCount).toBe(1);
    }
  });
});
