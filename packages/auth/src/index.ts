// Server-side auth (use in API routes, Next.js server components)
export { auth } from './server.js';
export type { Auth } from './server.js';

// Web client exports (use in React/Next.js client components)
export {
  authClient,
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  organization,
  useActiveOrganization,
  useListOrganizations,
  admin,
} from './client.js';
