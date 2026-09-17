import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Spy the SOURCE module — the `classify-business/index.js` barrel re-exports it
// as a live getter which cannot be redefined. A restored spy is load-order
// independent and cannot leak across the shared worker graph (`isolate: false`).
import * as classifyBusinessModule from '../classify-business/classify-business.service.js';

import { reclassifyBusiness } from './reclassify-business.service.js';

describe('reclassifyBusiness', () => {
  let classifyBusinessMock: MockInstance;

  beforeEach(() => {
    classifyBusinessMock = (
      vi.spyOn(
        classifyBusinessModule,
        'classifyBusiness'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
  });

  afterEach(() => {
    classifyBusinessMock.mockRestore();
  });

  it('forwards organizationId and force to classifyBusiness', async () => {
    classifyBusinessMock.mockResolvedValue({ success: true, data: {} });

    await reclassifyBusiness({} as never, {
      organizationId: 'org_1',
      force: true,
    });

    expect(classifyBusinessMock).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      force: true,
    });
  });

  it('defaults force to undefined (idempotent path)', async () => {
    classifyBusinessMock.mockResolvedValue({ success: true, data: {} });

    await reclassifyBusiness({} as never, { organizationId: 'org_1' });

    expect(classifyBusinessMock).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      force: undefined,
    });
  });
});
