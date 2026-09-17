// Shared BullMQ reliability utilities.
//
// NOTE: deliberately NOT re-exported from `../index.js`. `dead-letter.ts`
// pulls in bullmq + redis + observability (→ @sentry/node), and the shared
// barrel is consumed by api-client/frontend bundles. Import directly:
//   import { safeJobId } from '../../../shared/queue/index.js';

export { safeJobId } from './safe-job-id.js';
export {
  DLQ_JOB_OPTIONS,
  getDeadLetterQueue,
  isTerminalFailure,
  moveToDeadLetter,
  type DeadLetterableJob,
  type MoveToDeadLetterInput,
} from './dead-letter.js';
