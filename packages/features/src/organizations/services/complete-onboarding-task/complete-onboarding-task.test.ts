import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { completeOnboardingTask } from './complete-onboarding-task.service.js';

// Mock the database exports

const mockDb = {
  query: {
    organization: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('completeOnboardingTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: '',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid taskId', async () => {
      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'invalid-task' as 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('organization lookup', () => {
    it('returns NOT_FOUND when organization does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Organization not found');
      }
    });
  });

  describe('success cases', () => {
    it('completes task when not already completed', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: [],
      });
      mockDb.returning.mockResolvedValueOnce([
        { completedOnboardingTasks: ['create-first-post'] },
      ]);

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedTasks).toEqual(['create-first-post']);
      }
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('returns current state when task already completed (idempotent)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: ['create-first-post', 'link-booking-system'],
      });

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedTasks).toEqual([
          'create-first-post',
          'link-booking-system',
        ]);
      }
      // Should NOT have called update since task was already completed
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('adds task to existing completed tasks', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: ['create-first-post'],
      });
      mockDb.returning.mockResolvedValueOnce([
        {
          completedOnboardingTasks: [
            'create-first-post',
            'link-booking-system',
          ],
        },
      ]);

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'link-booking-system',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedTasks).toEqual([
          'create-first-post',
          'link-booking-system',
        ]);
      }
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('handles null completedOnboardingTasks', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: null,
      });
      mockDb.returning.mockResolvedValueOnce([
        { completedOnboardingTasks: ['create-first-post'] },
      ]);

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedTasks).toEqual(['create-first-post']);
      }
    });

    it('returns NOT_FOUND when update returns no rows', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: [],
      });
      mockDb.returning.mockResolvedValueOnce([]);

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      }
    });
  });

  describe('error handling', () => {
    it('returns INTERNAL_ERROR on database failure during find', async () => {
      mockDb.query.organization.findFirst.mockRejectedValueOnce(
        new Error('DB failed')
      );

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });

    it('returns INTERNAL_ERROR on database failure during update', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        completedOnboardingTasks: [],
      });
      mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

      const result = await completeOnboardingTask(mockDb as never, {
        organizationId: 'org-123',
        taskId: 'create-first-post',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });
  });
});
