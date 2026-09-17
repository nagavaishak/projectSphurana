import {
  type OnboardingTask,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import type { LoopsContactProperties } from '@borradh-workspace/integrations/loops';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { fireLoopsEvent, updateLoopsContact } from '../../../shared/loops.js';
import {
  type CompleteOnboardingTaskInput,
  type CompleteOnboardingTaskResponse,
  completeOnboardingTaskSchema,
} from './complete-onboarding-task.schema.js';

/**
 * Internal implementation of complete-onboarding-task
 */
const completeOnboardingTaskImpl = async (
  db: DbConnection,
  input: CompleteOnboardingTaskInput
): Promise<Result<CompleteOnboardingTaskResponse>> => {
  // Validate input
  const parsed = completeOnboardingTaskSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, taskId, userEmail } = parsed.data;

  try {
    // Check if organization exists and get current tasks
    const existing = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { id: true, completedOnboardingTasks: true },
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Check if task is already completed
    const currentTasks = (existing.completedOnboardingTasks ??
      []) as OnboardingTask[];
    if (currentTasks.includes(taskId)) {
      // Already completed, return current state
      return ok({ completedTasks: currentTasks });
    }

    // Add task to completed list using JSON array append
    const [updated] = await db
      .update(organization)
      .set({
        completedOnboardingTasks: sql`${organization.completedOnboardingTasks} || ${JSON.stringify([taskId])}::jsonb`,
      })
      .where(and(eq(organization.id, organizationId), notDeleted(organization)))
      .returning({
        completedOnboardingTasks: organization.completedOnboardingTasks,
      });

    if (!updated) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Fire marketing events (non-blocking)
    if (userEmail) {
      const taskPropertyMap: Record<string, keyof LoopsContactProperties> = {
        'create-first-post': 'taskCreatePost',
        'link-booking-system': 'taskBooking',
        'customise-booking-page': 'taskBookingPage',
        'enable-lead-follow-up': 'taskLeadFollowUp',
        'launch-first-ad': 'taskAds',
      };
      const contactProp = taskPropertyMap[taskId];
      if (contactProp) {
        updateLoopsContact(userEmail, { [contactProp]: true });
      }
      fireLoopsEvent({
        email: userEmail,
        eventName: 'task_completed',
        eventProperties: { taskId },
      });
    }

    return ok({
      completedTasks: (updated.completedOnboardingTasks ??
        []) as OnboardingTask[],
    });
  } catch (error) {
    logError('organizations.completeOnboardingTask', error, {
      feature: 'organizations',
      extra: { organizationId, taskId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete onboarding task'
      )
    );
  }
};

/**
 * Mark an onboarding task as completed for an organization
 *
 * @param db - Database connection
 * @param input - Input with organization ID and task ID
 * @returns Result with updated completed tasks list
 *
 * @example
 * ```ts
 * const result = await completeOnboardingTask(db, {
 *   organizationId: 'org-123',
 *   taskId: 'create-first-post',
 * });
 *
 * if (result.success) {
 *   console.log('Completed tasks:', result.data.completedTasks);
 * }
 * ```
 */
export const completeOnboardingTask = (
  db: DbConnection,
  input: CompleteOnboardingTaskInput
) =>
  trackedResult(
    'organizations.completeOnboardingTask',
    () => withOrgScope((tx) => completeOnboardingTaskImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        taskId: input.taskId,
      },
    }
  );

/**
 * Result type for completeOnboardingTask
 */
export type CompleteOnboardingTaskResult = Awaited<
  ReturnType<typeof completeOnboardingTask>
>;
