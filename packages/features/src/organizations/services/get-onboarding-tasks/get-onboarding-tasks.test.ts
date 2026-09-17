import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getOnboardingTasks } from './get-onboarding-tasks.service.js';

describe('getOnboardingTasks', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: '',
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

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Organization not found');
      }
    });
  });

  describe('success cases', () => {
    it('returns all tasks with completion status when no tasks completed', async () => {
      // Organization exists
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
      });
      // No social post exists
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);
      // No active organization service exists
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
      // No booking account exists
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
      // No sequence with nodes exists
      mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
      // No meta ad with metaAdId exists
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks).toHaveLength(5);
        expect(result.data.tasks.every((t) => t.completed === false)).toBe(
          true
        );
        expect(result.data.completedCount).toBe(0);
        expect(result.data.totalCount).toBe(5);
      }
    });

    it('returns all tasks with completion status when some tasks completed', async () => {
      // Organization exists
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
      });
      // Social post exists (create-first-post completed)
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
        id: 'post-1',
      });
      // No active organization service (customise-booking-page not completed)
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
      // Booking account exists (link-booking-system completed)
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-1',
      });
      // No sequence (enable-lead-follow-up not completed)
      mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
      // No meta ad (launch-first-ad not completed)
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks).toHaveLength(5);
        expect(result.data.completedCount).toBe(2);
        expect(result.data.totalCount).toBe(5);

        const createPostTask = result.data.tasks.find(
          (t) => t.id === 'create-first-post'
        );
        expect(createPostTask?.completed).toBe(true);
        expect(createPostTask?.title).toBe('Create your first post');

        const linkBookingTask = result.data.tasks.find(
          (t) => t.id === 'link-booking-system'
        );
        expect(linkBookingTask?.completed).toBe(true);

        const launchAdTask = result.data.tasks.find(
          (t) => t.id === 'launch-first-ad'
        );
        expect(launchAdTask?.completed).toBe(false);
      }
    });

    it('returns all tasks completed when all tasks are done', async () => {
      // Organization exists
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
      });
      // All tasks have corresponding data
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
        id: 'post-1',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-1',
      });
      mockDb.query.sequence.findFirst.mockResolvedValueOnce({
        id: 'seq-1',
      });
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
        id: 'ad-1',
      });

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks.every((t) => t.completed === true)).toBe(true);
        expect(result.data.completedCount).toBe(5);
        expect(result.data.totalCount).toBe(5);
      }
    });

    it('includes correct titles for all tasks', async () => {
      // Organization exists
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
      });
      // All tasks not completed
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const taskMap = new Map(result.data.tasks.map((t) => [t.id, t.title]));
        expect(taskMap.get('create-first-post')).toBe('Create your first post');
        expect(taskMap.get('customise-booking-page')).toBe(
          'Customize your booking page'
        );
        expect(taskMap.get('link-booking-system')).toBe(
          'Link your booking system'
        );
        expect(taskMap.get('enable-lead-follow-up')).toBe(
          'Enable lead follow-up'
        );
        expect(taskMap.get('launch-first-ad')).toBe('Launch your first ad');
      }
    });
  });

  describe('error handling', () => {
    it('returns INTERNAL_ERROR on database failure', async () => {
      mockDb.query.organization.findFirst.mockRejectedValueOnce(
        new Error('DB failed')
      );

      const result = await getOnboardingTasks(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });
  });
});
