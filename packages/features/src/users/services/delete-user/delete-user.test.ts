import {
  beforeEach,
  createMockDatabase,
  describe,
  it,
  vi,
} from '@borradh-workspace/testing';

describe('deleteUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it.todo('should delete a user with valid ID');

  it.todo('should return NOT_FOUND if user does not exist');

  it.todo('should return VALIDATION_ERROR for invalid user ID');
});
