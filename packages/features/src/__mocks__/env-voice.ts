/**
 * Canonical mock for `@borradh-workspace/env/voice`.
 *
 * Aliased in vite.config.ts so tests never run the real `createEnv` (which
 * validates `process.env` against the voice schema), and so every test file
 * sees the *same* config object — a prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * env is CONFIG, not behaviour: this is a static fake object literal, not a set
 * of `vi.fn()`s.
 */

export const voiceEnv = {
  // ElevenLabs
  ELEVENLABS_API_KEY: 'mock-elevenlabs-api-key',
  ELEVENLABS_DEFAULT_VOICE_ID: '21m00Tcm4TlvDq8ikWAM',

  // Telnyx AI Assistants
  TELNYX_API_KEY: 'mock-telnyx-api-key',
  TELNYX_WEBHOOK_PUBLIC_KEY: 'mock-telnyx-webhook-public-key',
  TELNYX_OUTBOUND_PHONE_NUMBER: '+15555550123',
  TELNYX_DEFAULT_BACKGROUND_AUDIO: 'office',

  // TeXML Application ID
  TELNYX_TEXML_APP_ID: 'mock-telnyx-texml-app-id',

  // Integration secret refs
  TELNYX_ELEVENLABS_API_KEY_REF: 'mock-telnyx-elevenlabs-api-key-ref',
  TELNYX_LLM_API_KEY_REF: 'mock-telnyx-llm-api-key-ref',

  // Voice tools webhook
  VOICE_TOOLS_WEBHOOK_URL: 'https://mock.example.com/voice/tools',
};
