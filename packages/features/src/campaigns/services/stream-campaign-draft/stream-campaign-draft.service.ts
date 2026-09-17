import {
  initAIClient,
  isAIClientInitialized,
  streamChatCompletion,
} from '@borradh-workspace/ai';
import type { CampaignChannel } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { CAMPAIGN_VOICE_RULES } from '../_shared/copy-voice.js';

function ensureAIClient(): void {
  if (!isAIClientInitialized()) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    initAIClient({ apiKey });
  }
}

const CHANNEL_GUIDANCE: Record<CampaignChannel, string> = {
  email:
    'Write an email body (NO subject line, just the body). 2–4 short sentences with one clear call to action. Begin with the personalization token exactly as {{firstName|there}}.',
  sms: 'Write a single SMS under 300 characters with one clear call to action. Begin with the personalization token exactly as {{firstName|there}}.',
  // WhatsApp sends through the canonical template, whose {{1}} auto-fills the
  // first name and whose footer already carries the STOP opt-out line. The AI
  // only authors {{2}} — the message body — so it must NOT add its own greeting
  // or STOP line (that would double them up in the delivered message).
  whatsapp:
    'Write ONLY the message body that fills the template (1–3 short sentences); do not add a greeting or a STOP line — those are added by the template.',
};

/**
 * Stream OpenAI-generated campaign copy for a channel, token by token.
 *
 * A plain async generator (not a Result service) because the controller pipes
 * it straight to an SSE response. `streamChatCompletion` carries its own
 * $ai_generation observability.
 */
export async function* streamCampaignDraft(input: {
  channel: CampaignChannel;
  prompt: string;
  businessName?: string;
}): AsyncGenerator<string, void, unknown> {
  ensureAIClient();
  const brand = input.businessName
    ? `You write customer messages for "${input.businessName}", a beauty/aesthetics clinic.`
    : 'You write customer messages for a beauty/aesthetics clinic.';
  const system = `${brand} ${CHANNEL_GUIDANCE[input.channel]} Output ONLY the message text — no quotes, no labels, no preamble.

${CAMPAIGN_VOICE_RULES}`;

  yield* streamChatCompletion(input.prompt, {
    systemMessage: system,
    temperature: 0.6,
    maxTokens: 300,
  });
}
