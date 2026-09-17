// Leads feature barrel export

// Services
export {
  // create-lead
  createLead,
  createLeadSchema,
  type CreateLeadInput,
  type CreateLeadResult,
  // create-meta-form-lead — the single writer for Meta instant-form leads,
  // shared by the leadgen webhook and the reconciliation poll (ENG-786).
  createMetaFormLead,
  type CreateMetaFormLeadInput,
  type CreateMetaFormLeadResult,
  // get-lead
  getLead,
  getLeadSchema,
  type GetLeadInput,
  type GetLeadResult,
  type LeadDetail,
  type SourceLeadForm,
  // get-lead-profile
  getLeadProfile,
  getLeadProfileSchema,
  type GetLeadProfileInput,
  type GetLeadProfileResult,
  type LeadProfile,
  type LeadProfileAppointment,
  type LeadProfileConsentFormSubmission,
  type LeadProfileDocument,
  type LeadProfileLead,
  // list-leads
  listLeads,
  listLeadsSchema,
  type ListLeadsInput,
  type ListLeadsResult,
  // update-lead
  updateLead,
  updateLeadSchema,
  type UpdateLeadInput,
  type UpdateLeadResult,
  // delete-lead
  deleteLead,
  deleteLeadSchema,
  type DeleteLeadInput,
  type DeleteLeadResult,
  // assign-sequence
  assignSequence,
  assignSequenceSchema,
  type AssignSequenceInput,
  type AssignSequenceResult,
  // list-lead-history
  listLeadHistory,
  listLeadHistorySchema,
  type ListLeadHistoryInput,
  type ListLeadHistoryResult,
  // import-leads
  importLeads,
  importLeadsSchema,
  importLeadRowSchema,
  type ImportLeadsInput,
  type ImportLeadRow,
  type ImportLeadsResult,
  type ImportError,
  type DeduplicateBy,
  type OnDuplicate,
  deduplicateByValues,
  onDuplicateValues,
  // import-leads-csv
  importLeadsCsv,
  importLeadsCsvSchema,
  MAX_CSV_BYTES,
  type ImportLeadsCsvInput,
  type ImportLeadsCsvResult,
  // normalize-lead
  normalizeLead,
  normalizeLeadSchema,
  type NormalizeLeadInput,
  type NormalizedLeadFields,
  type NormalizeLeadResult,
  // create-normalized-lead
  createNormalizedLead,
  createNormalizedLeadSchema,
  type CreateNormalizedLeadInput,
  type CreateNormalizedLeadResult,
  // export-leads-csv
  exportLeadsToCsv,
  exportLeadsCsvSchema,
  type ExportLeadsCsvData,
  type ExportLeadsCsvInput,
  type ExportLeadsCsvResult,
  // export-leads
  exportLeads,
  exportLeadsSchema,
  type ExportLeadsInput,
  type ExportLeadsResult,
  // get-lead-stats
  getLeadStats,
  getLeadStatsSchema,
  type GetLeadStatsInput,
  type GetLeadStatsResult,
  // get-lead-stage-counts
  getLeadStageCounts,
  getLeadStageCountsSchema,
  type GetLeadStageCountsInput,
  type GetLeadStageCountsResult,
  // lead-stage (derived; only conversion is written)
  derivedLeadStage,
  derivedStageInTab,
  recordLeadConversion,
  // record-lead-visit
  recordLeadVisitAndSpend,
  // notify-lead-created
  notifyLeadCreated,
  notifyLeadCreatedSafe,
  notifyLeadCreatedSchema,
  type NotifyLeadCreatedInput,
  type NotifyLeadCreatedResult,
  // summarise-recent-leads
  summariseRecentLeads,
  summariseRecentLeadsSchema,
  summariseRecentLeadsTimeframeValues,
  type SummariseRecentLeadsInput,
  type SummariseRecentLeadsTimeframe,
  type SummariseRecentLeadsResult,
  // advance-lead-stage
  advanceLeadStage,
  type AdvanceLeadStageInput,
} from './services/index.js';

// Models
export {
  type Lead,
  type LeadListItem,
  type UpdatedLead,
  LeadErrorCodes,
  type LeadErrorCode,
} from './models/index.js';
export { relocateLeadHomeBranch } from './shared/relocate-leads.js';
