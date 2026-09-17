// Sequences feature barrel export

// Services
export {
  // create-sequence
  createSequence,
  createSequenceSchema,
  type CreateSequenceInput,
  type CreateSequenceResult,
  // get-sequence
  getSequence,
  getSequenceSchema,
  type GetSequenceInput,
  type GetSequenceResult,
  // list-sequences
  listSequences,
  listSequencesSchema,
  type ListSequencesInput,
  type ListSequencesResult,
  // update-sequence
  updateSequence,
  updateSequenceSchema,
  type UpdateSequenceInput,
  type UpdateSequenceResult,
  // delete-sequence
  deleteSequence,
  deleteSequenceSchema,
  type DeleteSequenceInput,
  type DeleteSequenceResult,
  // activate-sequence
  activateSequence,
  activateSequenceSchema,
  type ActivateSequenceInput,
  type ActivateSequenceResult,
  // deactivate-sequence
  deactivateSequence,
  deactivateSequenceSchema,
  type DeactivateSequenceInput,
  type DeactivateSequenceResult,
  // sequence-executor
  processPendingExecutions,
  type ProcessPendingExecutionsResult,
  // version history
  listSequenceVersions,
  listSequenceVersionsSchema,
  type ListSequenceVersionsInput,
  type ListSequenceVersionsResult,
  createSequenceVersion,
  createSequenceVersionSchema,
  type CreateSequenceVersionInput,
  type CreateSequenceVersionResult,
  restoreSequenceVersion,
  restoreSequenceVersionSchema,
  type RestoreSequenceVersionInput,
  type RestoreSequenceVersionResult,
  // executions
  listExecutions,
  listExecutionsSchema,
  type ListExecutionsInput,
  type ExecutionWithDetails,
  type ListExecutionsResult,
  // execution history
  getLeadExecutionHistory,
  getLeadExecutionHistorySchema,
  type GetLeadExecutionHistoryInput,
  type GetLeadExecutionHistoryResult,
  type LeadExecutionHistory,
  type ExecutionHistoryStep,
  type CallbackInfo,
  // test actions
  testEmail,
  testEmailSchema,
  type TestEmailInput,
  type TestEmailServiceResult,
  type TestEmailResult,
  testSms,
  testSmsSchema,
  type TestSmsInput,
  type TestSmsServiceResult,
  type TestSmsResult,
  testCall,
  testCallSchema,
  type TestCallInput,
  type TestCallServiceResult,
  type TestCallResult,
} from './services/index.js';

// Models
export {
  type Sequence,
  type UpdatedSequence,
  SequenceErrorCodes,
  type SequenceErrorCode,
  PLATFORM_EMAIL_ID,
  PLATFORM_CALENDAR_ID,
} from './models/index.js';

// Templates
export {
  createDefaultFollowUpSequenceTemplate,
  type DefaultSequenceTemplate,
  createReviewCampaignSequenceTemplate,
  type ReviewCampaignTemplate,
  createReactivationCampaignSequenceTemplate,
  type ReactivationCampaignTemplate,
} from './templates/index.js';
