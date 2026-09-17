// Client-safe assistant models (no server-side dependencies)
// Use this entry point in frontend apps to avoid pulling in server-side code
export {
  getPlanAssistantLimits,
  PLAN_ASSISTANT_LIMITS,
  type PlanAssistantLimits,
} from './models/index.js';
