import { describe, expect, it } from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';

import { selectBeforeAfterClips } from './select-before-after-clips.service.js';

// `selectBeforeAfterClips` is retired and never touches the db.
const db = {} as never;

/**
 * The before/after format is WITHDRAWN — see `RETIRED_TEMPLATE_IDS`.
 *
 * These tests previously asserted the selection behaviour (ordered
 * before → procedure → after, service-linked footage preferred, and so on).
 * That behaviour was the bug: the `before`/`after` tags it keyed on are
 * written by the vision model, not a person, and the pairing was "first
 * org-wide before + first different after" — no client, no service scoping.
 * A prod audit found 32 before + 32 after assets with `client_name` set on
 * ZERO of them, so no pair was ever honestly matched.
 *
 * What matters now is that the service always declines, for every input,
 * including the inputs that used to succeed.
 */
describe('selectBeforeAfterClips (retired)', () => {
  it('declines even when before/after media would have been available', async () => {
    const result = await selectBeforeAfterClips(db, {
      organizationId: 'org-1',
      serviceId: 'svc-1',
      procedureClipCount: 2,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('declines without a service id', async () => {
    const result = await selectBeforeAfterClips(db, {
      organizationId: 'org-1',
      procedureClipCount: 0,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('explains why, so Claire can relay it to the owner', async () => {
    const result = await selectBeforeAfterClips(db, {
      organizationId: 'org-1',
      serviceId: 'svc-1',
      procedureClipCount: 2,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    // The message must name the reason (same client / same treatment), not
    // just fail — the owner needs to understand this is deliberate.
    expect(result.error.message).toMatch(/same client/i);
    expect(result.error.message).toMatch(/withdrawn|paused/i);
  });
});
