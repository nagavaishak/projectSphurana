/**
 * Test data factories for creating consistent test fixtures
 */

/**
 * Test user type matching the database schema
 */
export interface TestUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Test post type for post-related tests
 */
export interface TestPost {
  id: string;
  title: string;
  content: string;
  authorId: string;
  status: 'draft' | 'published';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates a mock UUID
 * Uses a predictable format for easier test assertions
 */
export function createMockId(suffix: string | number = '001'): string {
  const paddedSuffix = String(suffix).padStart(3, '0');
  return `00000000-0000-0000-0000-${paddedSuffix.padStart(12, '0')}`;
}

/**
 * Creates a mock date for consistent test fixtures
 * Defaults to a fixed date to avoid flaky tests
 */
export function createMockDate(offset = 0): Date {
  const baseDate = new Date('2024-01-01T00:00:00.000Z');
  return new Date(baseDate.getTime() + offset * 1000);
}

/**
 * Creates a test user with default values
 *
 * @example
 * ```typescript
 * const user = createTestUser();
 * // { id: '...', email: 'test-001@example.com', name: 'Test User 001', ... }
 *
 * const customUser = createTestUser({ email: 'custom@example.com', name: 'Custom Name' });
 * ```
 */
export function createTestUser(
  overrides: Partial<TestUser> = {},
  index = 1
): TestUser {
  const paddedIndex = String(index).padStart(3, '0');

  return {
    id: createMockId(index),
    email: `test-${paddedIndex}@example.com`,
    name: `Test User ${paddedIndex}`,
    createdAt: createMockDate(index),
    updatedAt: createMockDate(index),
    ...overrides,
  };
}

/**
 * Creates a test post with default values
 *
 * @example
 * ```typescript
 * const post = createTestPost({ authorId: userId });
 *
 * const publishedPost = createTestPost({ status: 'published' });
 * ```
 */
export function createTestPost(
  overrides: Partial<TestPost> = {},
  index = 1
): TestPost {
  const paddedIndex = String(index).padStart(3, '0');

  return {
    id: createMockId(1000 + index), // Different range from users
    title: `Test Post ${paddedIndex}`,
    content: `This is the content of test post ${paddedIndex}`,
    authorId: createMockId(1), // Default to first user
    status: 'draft',
    createdAt: createMockDate(index),
    updatedAt: createMockDate(index),
    ...overrides,
  };
}

/**
 * Creates multiple test users
 *
 * @example
 * ```typescript
 * const users = createTestUsers(5);
 * // Returns array of 5 test users
 * ```
 */
export function createTestUsers(
  count: number,
  overrides: Partial<TestUser> = {}
): TestUser[] {
  return Array.from({ length: count }, (_, i) =>
    createTestUser(overrides, i + 1)
  );
}

/**
 * Creates multiple test posts
 */
export function createTestPosts(
  count: number,
  overrides: Partial<TestPost> = {}
): TestPost[] {
  return Array.from({ length: count }, (_, i) =>
    createTestPost(overrides, i + 1)
  );
}
