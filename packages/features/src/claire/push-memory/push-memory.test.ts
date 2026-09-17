import type { AssistantRecommendation } from '@borradh-workspace/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endCycle,
  getCurrentCycle,
  hasPushedTopPick,
  markTopPickPushed,
  setDraftPointer,
} from './index.js';

const fakeRow = (
  overrides: Partial<AssistantRecommendation> = {}
): AssistantRecommendation =>
  ({
    id: 'rec_1',
    organizationId: 'org_1',
    kind: 'ad_flow_service_pick',
    title: 'Service pick — chat',
    body: 'body',
    primaryAction: { label: 'Open chat', type: 'none' },
    state: 'active',
    priority: 0,
    metadata: {
      surface: 'chat',
      conversationId: 'conv_1',
      rankedServiceId: 'svc_1',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    actionedAt: null,
    dismissedAt: null,
    expiresAt: null,
    ...overrides,
  }) as AssistantRecommendation;

const buildSelectChain = (rows: AssistantRecommendation[]) => {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  return { select: vi.fn().mockReturnValue({ from }), limit, orderBy, where };
};

describe('hasPushedTopPick', () => {
  it('returns false when no active cycle row exists', async () => {
    const chain = buildSelectChain([]);
    const db = { select: chain.select } as unknown as Parameters<
      typeof hasPushedTopPick
    >[0];

    const result = await hasPushedTopPick(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(false);
  });

  it('returns true when an active cycle row exists', async () => {
    const chain = buildSelectChain([fakeRow()]);
    const db = { select: chain.select } as unknown as Parameters<
      typeof hasPushedTopPick
    >[0];

    const result = await hasPushedTopPick(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(true);
  });
});

describe('markTopPickPushed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a new cycle row when none exists', async () => {
    const selectChain = buildSelectChain([]); // no existing cycle
    const insertReturning = vi.fn().mockResolvedValue([fakeRow()]);
    const insertValues = vi
      .fn()
      .mockReturnValue({ returning: insertReturning });
    const db = {
      select: selectChain.select,
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    } as unknown as Parameters<typeof markTopPickPushed>[0];

    const result = await markTopPickPushed(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    expect(insertValues).toHaveBeenCalledOnce();
    const args = insertValues.mock.calls[0]?.[0];
    expect(args.kind).toBe('ad_flow_service_pick');
    expect(args.metadata).toMatchObject({
      surface: 'chat',
      conversationId: 'conv_1',
      rankedServiceId: 'svc_1',
    });
  });

  it('is idempotent — returns existing row without inserting', async () => {
    const existing = fakeRow();
    const selectChain = buildSelectChain([existing]);
    const insertValues = vi.fn();
    const db = {
      select: selectChain.select,
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    } as unknown as Parameters<typeof markTopPickPushed>[0];

    const result = await markTopPickPushed(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(existing.id);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('setDraftPointer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a new cycle when none exists and pins draftId', async () => {
    const selectChain = buildSelectChain([]);
    const insertReturning = vi
      .fn()
      .mockResolvedValue([
        fakeRow({ metadata: { conversationId: 'conv_1', draftId: 'draft_a' } }),
      ]);
    const insertValues = vi
      .fn()
      .mockReturnValue({ returning: insertReturning });
    const db = {
      select: selectChain.select,
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    } as unknown as Parameters<typeof setDraftPointer>[0];

    const result = await setDraftPointer(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      draftId: 'draft_a',
    });

    expect(result.success).toBe(true);
    expect(insertValues).toHaveBeenCalledOnce();
    const args = insertValues.mock.calls[0]?.[0];
    expect(args.metadata.draftId).toBe('draft_a');
  });

  it('updates existing cycle metadata when one exists', async () => {
    const existing = fakeRow();
    const selectChain = buildSelectChain([existing]);
    const updateReturning = vi
      .fn()
      .mockResolvedValue([{ ...existing, metadata: { draftId: 'draft_a' } }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: selectChain.select,
      update: vi.fn().mockReturnValue({ set: updateSet }),
    } as unknown as Parameters<typeof setDraftPointer>[0];

    const result = await setDraftPointer(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      draftId: 'draft_a',
    });

    expect(result.success).toBe(true);
    expect(updateSet).toHaveBeenCalledOnce();
    const setArgs = updateSet.mock.calls[0]?.[0];
    expect(setArgs.metadata.draftId).toBe('draft_a');
    // existing metadata fields preserved
    expect(setArgs.metadata.conversationId).toBe('conv_1');
  });
});

describe('endCycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks an active cycle as actioned', async () => {
    const existing = fakeRow();
    const selectChain = buildSelectChain([existing]);
    const updateReturning = vi
      .fn()
      .mockResolvedValue([
        { ...existing, state: 'actioned', actionedAt: new Date() },
      ]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: selectChain.select,
      update: vi.fn().mockReturnValue({ set: updateSet }),
    } as unknown as Parameters<typeof endCycle>[0];

    const result = await endCycle(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      resolution: 'actioned',
    });

    expect(result.success).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'actioned' })
    );
  });

  it('returns null when no active cycle exists (idempotent)', async () => {
    const selectChain = buildSelectChain([]);
    const updateSet = vi.fn();
    const db = {
      select: selectChain.select,
      update: vi.fn().mockReturnValue({ set: updateSet }),
    } as unknown as Parameters<typeof endCycle>[0];

    const result = await endCycle(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_service_pick',
      resolution: 'dismissed',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe('getCurrentCycle', () => {
  it('returns null when nothing matches', async () => {
    const chain = buildSelectChain([]);
    const db = { select: chain.select } as unknown as Parameters<
      typeof getCurrentCycle
    >[0];

    const result = await getCurrentCycle(db, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      kind: 'ad_flow_offer_pick',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });
});
