import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const voiceEnv = createEnv({
  server: {
    // ElevenLabs (used as TTS provider within Telnyx)
    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_DEFAULT_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'), // Rachel

    // Telnyx AI Assistants — primary voice platform
    TELNYX_API_KEY: z.string().optional(),
    TELNYX_WEBHOOK_PUBLIC_KEY: z.string().optional(),
    TELNYX_OUTBOUND_PHONE_NUMBER: z.string().optional(),
    TELNYX_DEFAULT_BACKGROUND_AUDIO: z.string().default('office'),

    // TeXML Application ID (created in Telnyx portal, used for outbound calls)
    TELNYX_TEXML_APP_ID: z.string().optional(),

    // Integration secret name for ElevenLabs API key in Telnyx portal (optional)
    TELNYX_ELEVENLABS_API_KEY_REF: z.string().optional(),

    // Integration secret name for LLM (OpenAI) API key in Telnyx portal (required for OpenAI models)
    TELNYX_LLM_API_KEY_REF: z.string().optional(),

    // Webhook URL for voice tool calls (e.g. check_availability, book_appointment)
    VOICE_TOOLS_WEBHOOK_URL: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
