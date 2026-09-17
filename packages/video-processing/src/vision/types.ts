import type { AssetContentType } from '@borradh-workspace/database';

/**
 * Action segment labels for classifying video time ranges
 */
export type ActionSegmentLabel = 'action' | 'transition' | 'idle';

/**
 * A timestamped segment within a video indicating what kind of activity
 * is happening (action/procedure, transition, or idle)
 */
export interface ActionSegment {
  startSec: number;
  endSec: number;
  label: ActionSegmentLabel;
  description?: string;
}

/**
 * Configuration for Vision API
 */
export interface VisionApiConfig {
  apiKey: string;
  model?: VisionModel;
  maxTokens?: number;
  verbose?: boolean;
}

/**
 * Supported vision models
 */
export type VisionModel =
  | 'gpt-5.6-luna'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo';

/**
 * Context for video analysis
 */
export interface VideoAnalysisContext {
  organizationServices: string[];
  businessType: string;
}

/**
 * Matched service from AI analysis
 */
export interface MatchedService {
  serviceName: string;
  confidence: number;
}

/**
 * What is VISIBLY in the asset, independent of the org's service catalogue.
 *
 * Kept separate from service matching on purpose: a vision model can reliably
 * report "a syringe at the brow", but cannot tell "Classic Facial - Gold" from
 * "- Platinum", because nothing visible distinguishes them. Observation is the
 * part that is actually answerable from pixels.
 */
export interface AssetObservation {
  /** e.g. "syringe", "laser handpiece", "cream or mask". Null if not visible. */
  instrument: string | null;
  /** e.g. "brow", "full face", "abdomen". Null if not visible. */
  bodyArea: string | null;
  /**
   * False for infographics, posters, screenshots and logos — designed assets
   * that are not a recording of a real person, place or procedure. These were
   * being linked to services and cut into treatment videos as b-roll.
   */
  isRealFootage: boolean;
}

/**
 * Which service the asset DEPICTS — at most one, plus same-procedure variants.
 *
 * `serviceName: null` is an explicit abstention and is the CORRECT answer
 * whenever the visible evidence doesn't identify a service. Publishing the
 * wrong footage for a treatment is far more costly than publishing none.
 */
export interface ServiceIdentification {
  serviceName: string | null;
  confidence: number;
  /**
   * Services that are the SAME procedure as the one shown — tiers, durations
   * or treated-area variants. This is what keeps "Anti-wrinkle (one/two/three
   * areas)" legitimately sharing footage while preventing a sauna clip from
   * also claiming to be cryotherapy.
   */
  alsoValidFor: string[];
}

/**
 * Quality flags for asset assessment
 */
export interface QualityFlags {
  isShaky?: boolean;
  isBlurry?: boolean;
  isPoorLighting?: boolean;
  showsOnlyEquipment?: boolean;
  isTooShort?: boolean;
}

/**
 * Result from AI vision analysis
 */
export interface VisionAnalysisResult {
  description: string;
  contentType: AssetContentType;
  /**
   * Derived from {@link ServiceIdentification} when the model supplies it —
   * the primary service plus its same-procedure variants. Empty when the model
   * abstained, which is what stops us writing a link at all.
   */
  matchedServices: MatchedService[];
  observation?: AssetObservation;
  serviceIdentification?: ServiceIdentification;
  suggestedTags: string[];
  actionSegments?: ActionSegment[];
  /** Quality score from 0 (unusable) to 1 (excellent) */
  qualityScore?: number;
  /** Specific quality issues detected */
  qualityFlags?: QualityFlags;
}

/**
 * Raw response from the AI model
 */
export interface VisionApiResponse {
  description: string;
  contentType: string;
  /** Legacy shape — retained so a non-compliant response still parses. */
  matchedServices: Array<{
    serviceName: string;
    confidence: number;
  }>;
  observation?: {
    instrument?: string | null;
    bodyArea?: string | null;
    isRealFootage?: boolean;
  };
  serviceIdentification?: {
    serviceName?: string | null;
    confidence?: number;
    alsoValidFor?: string[];
  };
  suggestedTags: string[];
  actionSegments?: Array<{
    startSec: number;
    endSec: number;
    label: string;
    description?: string;
  }>;
  qualityScore?: number;
  qualityFlags?: {
    isShaky?: boolean;
    isBlurry?: boolean;
    isPoorLighting?: boolean;
    showsOnlyEquipment?: boolean;
    isTooShort?: boolean;
  };
}
