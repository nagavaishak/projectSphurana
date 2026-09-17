import {
  type OnboardingTask,
  bookingAccount,
  metaAd,
  organization,
  organizationService,
  sequence,
  socialPost,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  onboardingTaskLabels,
  onboardingTaskValues,
} from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetOnboardingTasksInput,
  getOnboardingTasksSchema,
} from './get-onboarding-tasks.schema.js';

/**
 * Single onboarding task status
 */
export interface OnboardingTaskStatus {
  id: OnboardingTask;
  title: string;
  completed: boolean;
}

/**
 * Response type for get-onboarding-tasks
 */
export interface GetOnboardingTasksResponse {
  tasks: OnboardingTaskStatus[];
  completedCount: number;
  totalCount: number;
}

/**
 * Check if a task is completed based on actual data in the database
 */
const checkTaskCompletion = async (
  db: DbConnection,
  organizationId: string,
  taskId: OnboardingTask
): Promise<boolean> => {
  switch (taskId) {
    case 'create-first-post': {
      // Check if any social post exists
      const post = await db.query.socialPost.findFirst({
        where: eq(socialPost.organizationId, organizationId),
        columns: { id: true },
      });
      return !!post;
    }

    case 'customise-booking-page': {
      // Check if any active service exists (booking page works via /book/{orgSlug})
      const service = await db.query.organizationService.findFirst({
        where: and(
          eq(organizationService.organizationId, organizationId),
          eq(organizationService.isActive, true)
        ),
        columns: { id: true },
      });
      return !!service;
    }

    case 'link-booking-system': {
      // Check if any booking account is connected
      const booking = await db.query.bookingAccount.findFirst({
        where: eq(bookingAccount.organizationId, organizationId),
        columns: { id: true },
      });
      return !!booking;
    }

    case 'enable-lead-follow-up': {
      // Check if any sequence exists with nodes configured
      const seq = await db.query.sequence.findFirst({
        where: and(
          eq(sequence.organizationId, organizationId),
          isNotNull(sequence.nodes),
          notDeleted(sequence)
        ),
        columns: { id: true },
      });
      return !!seq;
    }

    case 'launch-first-ad': {
      // Check if any ad has been launched (has a Meta ad ID)
      const ad = await db.query.metaAd.findFirst({
        where: and(
          eq(metaAd.organizationId, organizationId),
          isNotNull(metaAd.metaAdId)
        ),
        columns: { id: true },
      });
      return !!ad;
    }

    default:
      return false;
  }
};

/**
 * Internal implementation of get-onboarding-tasks
 */
const getOnboardingTasksImpl = async (
  db: DbConnection,
  input: GetOnboardingTasksInput
): Promise<Result<GetOnboardingTasksResponse>> => {
  // Validate input
  const parsed = getOnboardingTasksSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    // Verify organization exists
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { id: true },
    });

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Check completion status for each task based on actual data
    const tasks: OnboardingTaskStatus[] = await Promise.all(
      onboardingTaskValues.map(async (taskId) => ({
        id: taskId,
        title: onboardingTaskLabels[taskId],
        completed: await checkTaskCompletion(db, organizationId, taskId),
      }))
    );

    const completedCount = tasks.filter((t) => t.completed).length;

    return ok({
      tasks,
      completedCount,
      totalCount: onboardingTaskValues.length,
    });
  } catch (error) {
    logError('organizations.getOnboardingTasks', error, {
      feature: 'organizations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to get onboarding tasks'
      )
    );
  }
};

/**
 * Get onboarding tasks with completion status for an organization
 *
 * @param db - Database connection
 * @param input - Input with organization ID
 * @returns Result with tasks and completion status
 *
 * @example
 * ```ts
 * const result = await getOnboardingTasks(db, {
 *   organizationId: 'org-123',
 * });
 *
 * if (result.success) {
 *   console.log('Tasks:', result.data.tasks);
 *   console.log(`${result.data.completedCount}/${result.data.totalCount} completed`);
 * }
 * ```
 */
export const getOnboardingTasks = (
  db: DbConnection,
  input: GetOnboardingTasksInput
) =>
  trackedResult(
    'organizations.getOnboardingTasks',
    () => withOrgScope((tx) => getOnboardingTasksImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getOnboardingTasks
 */
export type GetOnboardingTasksResult = Awaited<
  ReturnType<typeof getOnboardingTasks>
>;
