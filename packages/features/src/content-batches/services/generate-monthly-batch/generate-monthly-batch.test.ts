import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, afterEach, vi } from 'vitest';
import * as dispatchMonthlyPlanModule from '../../../monthly-content-plan/services/dispatch-monthly-plan/dispatch-monthly-plan.service.js';
import * as planMonthlyContentModule from '../../../monthly-content-plan/services/plan-monthly-content/plan-monthly-content.service.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import type { PreparedMonthlyBatch } from './generate-monthly-batch.service.js';
import { seedMonthlyBatch } from './generate-monthly-batch.service.js';

// The seam that the stock-footage + durable-content-batch integration hinges
// on: the durable worker calls seedMonthlyBatch, which must forward the owner's
// `allowStockFootage` preference into BOTH the planner and the dispatcher (the
// dispatcher is where a service with no uploaded footage resolves a stock clip).
// If either drops the flag, stock silently never reaches the render.
//
// Restored `vi.spyOn`s on the SOURCE modules, not `vi.mock` of the barrels:
// under `isolate: false` the worker shares one module graph, so a hoisted
// factory leaks into every later file and silently misses once an earlier file
// has imported the real module. Barrel re-exports are live getters and cannot be
// spied, hence targeting `*.service.js`.
let planMonthlyContent: MockInstance;
let dispatchMonthlyPlan: MockInstance;

const preparedWith = (allowStockFootage: boolean): PreparedMonthlyBatch => ({
  batch: {
    id: 'batch_1',
    organizationId: 'org_1',
    periodMonth: '2026-07',
    status: 'planning',
  } as PreparedMonthlyBatch['batch'],
  batchId: 'batch_1',
  organizationId: 'org_1',
  periodMonth: '2026-07',
  createdById: 'user_1',
  graphicCount: 6,
  videoCount: 6,
  serviceIds: ['svc_1'],
  allowStockFootage,
  videoPositionOffset: 0,
  graphicPositionOffset: 0,
  shouldSeed: true,
  markFailedOnError: true,
});

describe('seedMonthlyBatch — stock-footage forwarding', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    planMonthlyContent = vi.spyOn(
      planMonthlyContentModule,
      'planMonthlyContent'
    );
    dispatchMonthlyPlan = vi.spyOn(
      dispatchMonthlyPlanModule,
      'dispatchMonthlyPlan'
    );
    mockDb.query.organization.findFirst.mockResolvedValue({
      id: 'org_1',
      primaryColor: '#abc',
    });
    // Final "promote to generating" update.
    mockDb.returning.mockResolvedValue([
      { id: 'batch_1', organizationId: 'org_1', status: 'generating' },
    ]);
    // Empty plan → no image materialisation, no video seeding: keeps the test
    // focused on the forwarding seam.
    planMonthlyContent.mockResolvedValue(ok({ items: [] }));
    dispatchMonthlyPlan.mockResolvedValue(
      ok({ videoIds: [], imageRequests: [], failures: [] })
    );
  });

  afterEach(() => {
    // Restore only THESE handles so they cannot outlive this file on the
    // shared module graph.
    planMonthlyContent.mockRestore();
    dispatchMonthlyPlan.mockRestore();
  });

  it('forwards allowStockFootage=true to both the planner and the dispatcher', async () => {
    const result = await seedMonthlyBatch(mockDb as never, preparedWith(true));

    expect(result.success).toBe(true);
    expect(planMonthlyContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStockFootage: true })
    );
    expect(dispatchMonthlyPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStockFootage: true })
    );
  });

  it('forwards an explicit allowStockFootage=false through unchanged', async () => {
    const result = await seedMonthlyBatch(mockDb as never, preparedWith(false));

    expect(result.success).toBe(true);
    expect(planMonthlyContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStockFootage: false })
    );
    expect(dispatchMonthlyPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStockFootage: false })
    );
  });

  // A batch stuck in 'planning' is a batch the client polls forever and a
  // button it never re-arms — the append path used to skip the write entirely
  // (`markFailedOnError: false` returned early), leaving exactly that.
  it('lands a failed top-up back on generating rather than stranding it', async () => {
    planMonthlyContent.mockResolvedValue(
      err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'planner exploded'))
    );

    const result = await seedMonthlyBatch(mockDb as never, {
      ...preparedWith(true),
      markFailedOnError: false,
    });

    expect(result.success).toBe(false);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'generating',
        errorMessage: expect.stringContaining('planner exploded'),
      })
    );
  });

  it('flips a fresh batch to failed, so the owner gets a retry', async () => {
    planMonthlyContent.mockResolvedValue(
      err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'planner exploded'))
    );

    const result = await seedMonthlyBatch(mockDb as never, preparedWith(true));

    expect(result.success).toBe(false);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});
