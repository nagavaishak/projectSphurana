import { auth } from '@borradh-workspace/auth/server';
import { db, withSystemScope } from '@borradh-workspace/database';
import { getSession } from '@borradh-workspace/features/auth';
import { MONITORED_QUEUE_NAMES } from '@borradh-workspace/features/jobs';
import { checkAdminAccess } from '@borradh-workspace/features/organizations';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import type { BaseAdapter } from '@bull-board/api/dist/src/queueAdapters/base';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';

// Lazy-initialized read-only Queue handles, one per registered queue.
let boardQueues: Queue[] | null = null;

/**
 * Every queue + DLQ, DERIVED from the job registry.
 *
 * The board used to show ONE queue (`video-render`) out of eighteen, so a
 * backlog anywhere else — reminders, campaign sends, chatbot flows — was
 * invisible to the only operator surface we have. Declaring a queue in
 * `packages/features/src/jobs/queues.ts` now puts it on the board.
 */
function getBoardQueues(): Queue[] {
  if (!boardQueues) {
    const connection = getRedis();
    const prefix = getBullMqPrefix();
    boardQueues = MONITORED_QUEUE_NAMES.map(
      (name) => new Queue(name, { connection, prefix })
    );
  }
  return boardQueues;
}

/**
 * Create the Bull Board Express adapter with authentication middleware
 */
export function createBullBoardAdapter(): ExpressAdapter {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  // Cast to BaseAdapter to work around type version mismatch between bullmq and @bull-board
  createBullBoard({
    queues: getBoardQueues().map(
      (queue) => new BullMQAdapter(queue) as unknown as BaseAdapter
    ),
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Queue Dashboard',
      },
    },
  });

  return serverAdapter;
}

/**
 * Authentication middleware for Bull Board
 * Checks if user is authenticated and has admin/owner role in their active organization
 */
export async function bullBoardAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract session token from cookies
    const token = req.cookies?.['__Secure-better-auth.session_token'];

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Validate session
    const result = await getSession(auth.api, { sessionToken: token });

    if (!result.success) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    const { user, session } = result.data;

    // Check if user has an active organization
    if (!session?.activeOrganizationId) {
      res.status(403).json({ error: 'No active organization selected' });
      return;
    }

    // Hoist the narrowed value: TS resets the narrowing inside the closure.
    const activeOrganizationId = session.activeOrganizationId;
    // Check if user has admin access in the active organization
    const accessResult = await withSystemScope(
      (conn) =>
        checkAdminAccess(conn, {
          userId: user.id,
          organizationId: activeOrganizationId,
        }),
      { db }
    );

    if (!accessResult.success) {
      res.status(500).json({ error: 'Failed to check access' });
      return;
    }

    if (!accessResult.data.hasAccess) {
      const errorMessage =
        accessResult.data.role === null
          ? 'Not a member of the active organization'
          : 'Admin access required';
      res.status(403).json({ error: errorMessage });
      return;
    }

    // User is authenticated and has admin access
    next();
  } catch (error) {
    console.error('[bull-board] Auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
