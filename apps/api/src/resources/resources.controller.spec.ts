/**
 * The branch a resource read is scoped to comes from the GUARD, not the query
 * string.
 *
 * All three resource reads shipped with a `?locationId=` filter before
 * `LocationGuard` existed, so both sources are present and one has to win. It
 * must be the header: `LocationGuard` has validated it against the active
 * organization, and the query string has not been validated against anything.
 *
 * `sales.controller.spec.ts` documents what the other order costs — `POST
 * /sales` once read `dto.locationId ?? activeLocationId` and let any
 * authenticated member stamp a sale with another org's location id. These
 * specs FAIL against that inverted precedence.
 *
 * The query param is kept as a FALLBACK rather than deleted, because unlike the
 * sales body it is a pre-existing read filter with callers; it applies only
 * when no header was sent.
 *
 * The features barrel reaches ESM-only packages swc-jest cannot transform, so
 * it is stubbed before the controller is imported — same pattern as
 * `sales.controller.spec.ts`.
 */
jest.mock(
  '@borradh-workspace/features/resources',
  () => {
    // The DTO barrel is imported transitively by the controller and calls
    // `.omit()` on these at module load, so they must be REAL zod objects.
    // Only the keys the DTOs omit or extend have to exist.
    const { z } = require('zod');
    const schema = z.object({
      id: z.string().optional(),
      organizationId: z.string().optional(),
      serviceId: z.string().optional(),
      locationId: z.string().optional(),
      includeInactive: z.boolean().optional(),
    });
    return {
      createResourceCategorySchema: schema,
      createResourceSchema: schema,
      getResourceUtilisationSchema: schema,
      listAppointmentResourcesSchema: schema,
      listResourceCategoriesSchema: schema,
      listResourcesSchema: schema,
      reorderResourcesSchema: schema,
      setServiceResourceRequirementsSchema: schema,
      updateResourceCategorySchema: schema,
      updateResourceSchema: schema,
      createResource: jest.fn(),
      createResourceCategory: jest.fn(),
      deleteResource: jest.fn(),
      deleteResourceCategory: jest.fn(),
      getResourceUtilisation: jest.fn(),
      getServiceResourceRequirements: jest.fn(),
      listAppointmentResources: jest.fn(),
      listResourceCategories: jest.fn(),
      listResources: jest.fn(),
      reorderResources: jest.fn(),
      setServiceResourceRequirements: jest.fn(),
      updateResource: jest.fn(),
      updateResourceCategory: jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock('@borradh-workspace/database', () => ({ db: {} }), { virtual: true });

jest.mock(
  '@borradh-workspace/features/shared',
  () => ({
    // The list DTOs coerce query strings through this.
    queryBoolean: () => {
      const { z } = require('zod');
      return z.boolean().optional();
    },
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

jest.mock('../common/index.js', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  ActiveOrganization: () => () => undefined,
  ActiveLocation: () => () => undefined,
}));

import {
  getResourceUtilisation,
  listAppointmentResources,
  listResources,
} from '@borradh-workspace/features/resources';
import type {
  ListAppointmentResourcesDto,
  ListResourcesDto,
  ResourceUtilisationDto,
} from './dto';
import { ResourcesController } from './resources.controller.js';

const listResourcesMock = listResources as unknown as jest.Mock;
const listAllocationsMock = listAppointmentResources as unknown as jest.Mock;
const utilisationMock = getResourceUtilisation as unknown as jest.Mock;

const WINDOW = { from: new Date('2026-06-01'), to: new Date('2026-06-08') };

describe('ResourcesController — the branch comes from the guard, not the query', () => {
  let controller: ResourcesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ResourcesController();
    for (const m of [listResourcesMock, listAllocationsMock, utilisationMock]) {
      m.mockResolvedValue({ success: true, data: [] });
    }
  });

  it('GET /resources ignores a query branch when the header named one', async () => {
    await controller.findAll(
      { locationId: 'loc-from-query' } as unknown as ListResourcesDto,
      'org-1',
      'loc-from-header'
    );

    expect(listResourcesMock.mock.calls[0][1]).toMatchObject({
      organizationId: 'org-1',
      locationId: 'loc-from-header',
    });
  });

  it('GET /resources/allocations does the same for the calendar feed', async () => {
    await controller.findAllocations(
      {
        ...WINDOW,
        locationId: 'loc-from-query',
      } as ListAppointmentResourcesDto,
      'org-1',
      'loc-from-header'
    );

    expect(listAllocationsMock.mock.calls[0][1]).toMatchObject({
      locationId: 'loc-from-header',
    });
  });

  it('GET /resources/utilisation does the same for the report', async () => {
    await controller.findUtilisation(
      { ...WINDOW, locationId: 'loc-from-query' } as ResourceUtilisationDto,
      'org-1',
      'loc-from-header'
    );

    expect(utilisationMock.mock.calls[0][1]).toMatchObject({
      locationId: 'loc-from-header',
    });
  });

  it('falls back to the query filter when no header was sent', async () => {
    // A client that predates `X-Location-Id` keeps working.
    await controller.findAll(
      { locationId: 'loc-from-query' } as unknown as ListResourcesDto,
      'org-1',
      undefined
    );

    expect(listResourcesMock.mock.calls[0][1]).toMatchObject({
      locationId: 'loc-from-query',
    });
  });

  it('stays org-wide when neither names a branch', async () => {
    await controller.findAll({} as ListResourcesDto, 'org-1', undefined);

    expect(listResourcesMock.mock.calls[0][1].locationId).toBeUndefined();
  });
});
