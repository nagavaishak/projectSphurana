// @borradh-workspace/testing
// Shared test utilities for the monorepo

// Re-export vitest for convenience
export {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest';
export type { Mock, MockedFunction, MockedObject } from 'vitest';

// Database mocks
export {
  createMockDatabase,
  createMockQueryBuilder,
  createMockDatabaseWithRollback,
  setupTransactionFailure,
} from './mocks/database.js';
export type {
  MockDatabase,
  MockQueryBuilder,
  MockQueryTable,
} from './mocks/database.js';

// Test data factories
export {
  createTestUser,
  createTestPost,
  createMockId,
  createMockDate,
} from './factories/index.js';
export type { TestUser, TestPost } from './factories/index.js';

// Test helpers
export { expectResult, expectSuccess, expectError } from './helpers/result.js';
export { waitFor, flushPromises } from './helpers/async.js';

// Custom matchers
export { setupCustomMatchers } from './matchers/index.js';
