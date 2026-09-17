import {
  beforeEach,
  createMockDatabase,
  describe,
  it,
  vi,
} from '@borradh-workspace/testing';

describe('updateUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it.todo('should update a user with valid input');

  it.todo('should return NOT_FOUND if user does not exist');

  it.todo('should return VALIDATION_ERROR for invalid user ID');

  it.todo('should return ALREADY_EXISTS if email is already in use');

  it.todo('should handle partial updates correctly');
});
