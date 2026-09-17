// Users feature barrel export

// Services
export {
  // create-user
  createUser,
  createUserSchema,
  type CreateUserInput,
  type CreateUserResult,
  // get-user
  getUser,
  getUserSchema,
  type GetUserInput,
  type GetUserResult,
  // update-user
  updateUser,
  updateUserSchema,
  type UpdateUserInput,
  type UpdateUserResult,
  // update-user-profile
  updateUserProfile,
  updateUserProfileSchema,
  type UpdateUserProfileInput,
  type UpdateUserProfileResult,
  // delete-user
  deleteUser,
  deleteUserSchema,
  type DeleteUserInput,
  type DeleteUserResult,
} from './services/index.js';

// Models
export {
  type User,
  type UpdatedUser,
  UserErrorCodes,
  type UserErrorCode,
} from './models/index.js';
