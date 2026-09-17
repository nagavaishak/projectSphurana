import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listConversations } from './list-conversations.service.js';

// The service issues four `db.select()` calls, in this order:
//   1. the EXISTS probe that hides message-less conversations
//   2. the `latest_msg` subquery
//   3. the items query — .from().leftJoin().where().orderBy().limit().offset()
//   4. the count query — .from().where()
//
// Mapping chains by call ORDER makes this suite brittle: adding a query at the
// top shifts every chain below it, which is exactly how the EXISTS filter broke
// it. What that filter actually guarantees — empty conversations excluded from
// the page AND the total — is SQL, and is asserted against a real database in
// apps/api/src/_integration/list-conversations.int-spec.ts. This suite is left
// covering the result shape and the validation error.
const createChain = () => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'from',
    'leftJoin',
    'where',
    'orderBy',
    'limit',
    'offset',
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // as() is used on the subquery result - returns a reference to itself for joining
  chain.as = vi.fn().mockReturnValue(chain);
  return chain;
};

let selectCallCount = 0;
const existsChain = createChain();
const subqueryChain = createChain();
const itemsChain = createChain();
const countChain = createChain();

const mockDb = {
  query: {
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
  },
  select: vi.fn().mockImplementation(() => {
    selectCallCount++;
    // Call 1: the EXISTS probe for "has at least one message"
    if (selectCallCount === 1) return existsChain;
    // Call 2: subquery for latest message
    if (selectCallCount === 2) return subqueryChain;
    // Call 3: main items query
    if (selectCallCount === 3) return itemsChain;
    // Call 4: count query
    return countChain;
  }),
};

describe('listConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  it('returns conversations for organization', async () => {
    const mockConversations = [
      {
        id: '1',
        chatbotId: 'bot-1',
        externalUserId: 'user-1',
        lastMessageContent: null,
        lastMessageRole: null,
      },
    ];
    // items query (chain 2) resolves at the end of its chain (offset)
    itemsChain.offset.mockResolvedValueOnce(mockConversations);
    // count query (chain 3) resolves at the end of its chain (where)
    countChain.where.mockResolvedValueOnce([{ count: 1 }]);

    const result = await listConversations(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversations).toHaveLength(1);
      expect(result.data.total).toBe(1);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listConversations(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
