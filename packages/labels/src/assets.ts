/**
 * Asset enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Asset type labels
export const assetTypeLabels = {
  video: 'Video',
  image: 'Image',
} as const;

export const assetTypeValues = Object.keys(assetTypeLabels) as [
  keyof typeof assetTypeLabels,
  ...(keyof typeof assetTypeLabels)[],
];

export type AssetType = keyof typeof assetTypeLabels;

// Placeholder type labels
export const placeholderTypeLabels = {
  owner_bodyshot: 'Owner Photo',
  owner_headshot: 'Owner Headshot',
  staff_photo: 'Staff Photo',
  client_result: 'Client Result',
  before: 'Before Photo',
  after: 'After Photo',
  location_exterior: 'Location Exterior',
  location_interior: 'Location Interior',
  product: 'Product Photo',
  procedure_generic: 'Procedure Photo',
  procedure_teeth_whitening: 'Teeth Whitening',
  procedure_haircut: 'Haircut',
  procedure_manicure: 'Manicure',
  procedure_facial: 'Facial',
  procedure_massage: 'Massage',
  procedure_tattoo: 'Tattoo',
  brand_logo: 'Brand Logo',
  other: 'Other',
} as const;

export const placeholderTypeValues = Object.keys(placeholderTypeLabels) as [
  keyof typeof placeholderTypeLabels,
  ...(keyof typeof placeholderTypeLabels)[],
];

export type PlaceholderType = keyof typeof placeholderTypeLabels;

// Asset analysis status labels
export const assetAnalysisStatusLabels = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
} as const;

export const assetAnalysisStatusValues = Object.keys(
  assetAnalysisStatusLabels
) as [
  keyof typeof assetAnalysisStatusLabels,
  ...(keyof typeof assetAnalysisStatusLabels)[],
];

export type AssetAnalysisStatus = keyof typeof assetAnalysisStatusLabels;

// Asset content type labels
export const assetContentTypeLabels = {
  talking_head: 'Talking Head',
  procedure: 'Procedure',
  environment: 'Environment',
  testimonial: 'Testimonial',
  result: 'Result',
  other: 'Other',
} as const;

export const assetContentTypeValues = Object.keys(assetContentTypeLabels) as [
  keyof typeof assetContentTypeLabels,
  ...(keyof typeof assetContentTypeLabels)[],
];

export type AssetContentType = keyof typeof assetContentTypeLabels;

// All valid content type TAG values (what goes in asset.tags)
export const assetContentTypeTagLabels = {
  before: 'Before',
  after: 'After',
  procedure: 'Procedure',
  environment: 'Environment',
  'employee-talking-head': 'Employee / Talking Head',
  testimonial: 'Testimonial',
  'pending-result': 'Pending Result',
  other: 'Other',
} as const;

export const assetContentTypeTagValues = Object.keys(
  assetContentTypeTagLabels
) as (keyof typeof assetContentTypeTagLabels)[];

export type AssetContentTypeTag = keyof typeof assetContentTypeTagLabels;

// Map from AI contentType enum → tag value
export const contentTypeToTagMap: Record<
  AssetContentType,
  AssetContentTypeTag
> = {
  procedure: 'procedure',
  environment: 'environment',
  talking_head: 'employee-talking-head',
  testimonial: 'testimonial',
  result: 'pending-result',
  other: 'other',
};

// Asset source labels (raw footage vs edited/polished vs curated stock)
export const assetSourceLabels = {
  raw: 'Raw Footage',
  edited: 'Edited / Polished',
  // Derived from a curated stock_clip on copy-on-attach. Pre-transcoded, so
  // these never flow through probe/transcode and are excluded from AI analysis.
  stock: 'Stock Footage',
} as const;

export const assetSourceValues = Object.keys(assetSourceLabels) as [
  keyof typeof assetSourceLabels,
  ...(keyof typeof assetSourceLabels)[],
];

export type AssetSource = keyof typeof assetSourceLabels;

// Asset upload batch status labels
export const assetUploadBatchStatusLabels = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  partial: 'Partial (some failed)',
  failed: 'Failed',
} as const;

export const assetUploadBatchStatusValues = Object.keys(
  assetUploadBatchStatusLabels
) as [
  keyof typeof assetUploadBatchStatusLabels,
  ...(keyof typeof assetUploadBatchStatusLabels)[],
];

export type AssetUploadBatchStatus = keyof typeof assetUploadBatchStatusLabels;
