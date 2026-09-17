// Local Whisper models (whisper.cpp)
export type WhisperModel =
  | 'tiny'
  | 'tiny.en'
  | 'base'
  | 'base.en'
  | 'small'
  | 'small.en'
  | 'medium'
  | 'medium.en'
  | 'large-v1'
  | 'large-v2'
  | 'large-v3'
  | 'large-v3-turbo';

// OpenAI Whisper API models
export type WhisperApiModel = 'whisper-1';

// Transcription mode
export type TranscriptionMode = 'local' | 'cloud';

// Local whisper.cpp configuration
export interface WhisperConfig {
  model: WhisperModel;
  installPath: string;
  version: string;
  verbose?: boolean;
}

// OpenAI Whisper API configuration
export interface WhisperApiConfig {
  apiKey: string;
  model?: WhisperApiModel;
  language?: string;
  verbose?: boolean;
}

// Unified transcription configuration
export interface TranscriptionConfig {
  mode: TranscriptionMode;
  local?: WhisperConfig;
  cloud?: WhisperApiConfig;
}

export interface Caption {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs?: number;
  confidence?: number | null;
}
