/**
 * Content Batches Types
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Enum types
export type {
  ContentBatchStatus,
  ContentBatchItemKind,
  ContentBatchItemReviewStatus,
  ContentBatchItemMessageRole,
} from '@borradh-workspace/api-client/types';

// Review thread — per-post conversational copy editing
export type {
  ContentItemMessage,
  ListBatchItemMessagesResponse,
  HandleReviewTurnInput,
  PendingRegenerateEdit,
  ReviewTurnResponse,
  SuggestedContentRule,
  UpdateBatchItemCaptionInput,
} from '@borradh-workspace/api-client/types';

// Entity types
export type {
  ContentBatch,
  ContentItem,
  ContentItemWithAsset,
  ContentBatchVideo,
  ContentBatchGraphic,
} from '@borradh-workspace/api-client/types';

// Response types
export type {
  GenerateContentBatchResponse,
  GetBatchResponse,
  ListContentBatchesResponse,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  GenerateContentBatchInput,
  ListContentBatchesFilters,
  RegenerateBatchItemInput,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  contentBatchStatusLabels,
  contentBatchStatusValues,
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  graphicUsageTypeLabels,
  graphicUsageTypeValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
} from '@borradh-workspace/api-client/types';
