import { db } from '@borradh-workspace/database';
import { buildDraftClipsSystemText as buildDraftClipsSystemTextService } from '@borradh-workspace/features/assistant';

/**
 * Polling-on-send draft-clips system block (W-C10-clip-tray Step 7).
 *
 * Thin wrapper around the features-package service. The DB-touching logic
 * lives there per the project rule that `apps/api` must not query the DB
 * directly. This wrapper preserves the controller's existing call signature
 * (`{ organizationId }` → `Promise<string | null>`) so we don't have to
 * push a Result-shape change through the controller.
 */
export async function buildDraftClipsSystemText({
  organizationId,
}: {
  organizationId: string;
}): Promise<string | null> {
  const result = await buildDraftClipsSystemTextService(db, { organizationId });
  if (!result.success) return null;
  return result.data.text;
}
