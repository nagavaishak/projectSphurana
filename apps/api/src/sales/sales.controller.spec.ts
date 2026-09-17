/**
 * `POST /sales` must book its takings to the branch the GUARD validated, never
 * to one the request body claims.
 *
 * This is the one sale-writing endpoint that used to read `dto.locationId ??
 * activeLocationId` — the body winning over the guard-validated
 * `X-Location-Id` header. That let any authenticated member of org A open a
 * sale stamped with org B's location id, and let one till book its takings to
 * another branch. The whole point of `LocationGuard` is that the header is the
 * only trusted source; the money path was the one route bypassing it.
 *
 * These tests drive the controller method directly with a body that carries a
 * foreign `locationId`. They FAIL against `dto.locationId ?? activeLocationId`.
 *
 * The features barrel reaches ESM-only packages that swc-jest can't transform,
 * so it is stubbed before the controller is imported — same pattern as
 * `campaigns.controller.spec.ts`.
 */
jest.mock(
  '@borradh-workspace/features/sales',
  () => ({
    addSaleItem: jest.fn(),
    addSalePayment: jest.fn(),
    cancelSalePayment: jest.fn(),
    completeSale: jest.fn(),
    createSale: jest.fn(),
    createSaleFromAppointment: jest.fn(),
    getDailySummary: jest.fn(),
    getSale: jest.fn(),
    listSales: jest.fn(),
    removeSaleItem: jest.fn(),
    setSaleClient: jest.fn(),
    setSaleTip: jest.fn(),
    settleCardPayment: jest.fn(),
    voidSale: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('@borradh-workspace/database', () => ({ db: {} }), { virtual: true });

jest.mock(
  '@borradh-workspace/features/shared',
  () => ({
    ErrorCodes: {
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      UNAUTHORIZED: 'UNAUTHORIZED',
      FORBIDDEN: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
  }),
  { virtual: true }
);

jest.mock('../common', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  ActiveOrganization: () => () => undefined,
  ActiveLocation: () => () => undefined,
  CurrentUser: () => () => undefined,
}));

import { createSale } from '@borradh-workspace/features/sales';
import type { CreateSaleDto } from './dto';
import { SalesController } from './sales.controller.js';

const createSaleMock = createSale as unknown as jest.Mock;

/**
 * The body a hostile (or merely stale) client sends. `locationId` is no longer
 * on `CreateSaleDto`, which is the fix — the cast is what a raw JSON body would
 * look like arriving at the method.
 */
const bodyClaiming = (locationId: string) =>
  ({ locationId }) as unknown as CreateSaleDto;

describe('SalesController.create — the branch comes from the guard, not the body', () => {
  let controller: SalesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SalesController();
    createSaleMock.mockResolvedValue({ success: true, data: { id: 'sale-1' } });
  });

  it('IGNORES a foreign locationId in the body and uses the validated header', async () => {
    await controller.create(
      bodyClaiming('loc-other-org'),
      'org-1',
      'loc-active',
      'user-1'
    );

    expect(createSaleMock).toHaveBeenCalledTimes(1);
    expect(createSaleMock.mock.calls[0][1]).toMatchObject({
      organizationId: 'org-1',
      createdById: 'user-1',
      locationId: 'loc-active',
    });
  });

  it('does not leak the body-claimed branch through the spread', async () => {
    await controller.create(
      bodyClaiming('loc-other-branch'),
      'org-1',
      'loc-active',
      'user-1'
    );

    const input = createSaleMock.mock.calls[0][1] as { locationId?: string };
    expect(input.locationId).not.toBe('loc-other-branch');
    expect(input.locationId).toBe('loc-active');
  });

  it('leaves the branch unset when no header was supplied, rather than trusting the body', async () => {
    await controller.create(
      bodyClaiming('loc-other-org'),
      'org-1',
      undefined,
      'user-1'
    );

    expect(createSaleMock.mock.calls[0][1]).toMatchObject({
      locationId: undefined,
    });
  });

  it('still forwards the one field the body legitimately owns', async () => {
    await controller.create(
      { leadId: 'lead-1' } as CreateSaleDto,
      'org-1',
      'loc-active',
      'user-1'
    );

    expect(createSaleMock.mock.calls[0][1]).toMatchObject({
      leadId: 'lead-1',
      locationId: 'loc-active',
    });
  });
});
