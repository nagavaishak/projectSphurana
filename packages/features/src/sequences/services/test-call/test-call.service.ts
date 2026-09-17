import {
  organization,
  voiceCall,
  voiceScript,
} from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import { createTelnyxAiService } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { selectPhoneNumber } from '../../../phone-numbers/services/select-phone-number/select-phone-number.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { type TestCallInput, testCallSchema } from './test-call.schema.js';

export interface TestCallResult {
  success: boolean;
  callControlId?: string;
  message: string;
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');
  // Ensure it starts with +
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

const testCallImpl = async (
  db: DbConnection,
  input: TestCallInput
): Promise<Result<TestCallResult>> => {
  const parsed = testCallSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { to, agentConfigId, organizationId } = parsed.data;

  // Check for required environment variables
  if (!voiceEnv.TELNYX_API_KEY) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Voice calling is not configured. Please contact support.'
      )
    );
  }

  // Get the voice script (agent configuration)
  const script = await db.query.voiceScript.findFirst({
    where: and(
      eq(voiceScript.id, agentConfigId),
      eq(voiceScript.organizationId, organizationId)
    ),
  });

  if (!script) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'AI agent configuration not found')
    );
  }

  // Get organization for org name (used in prompt)
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Select phone number from pool or fall back to global env var
  const selectedNumber = await selectPhoneNumber(db, { organizationId });

  let outboundNumber: string;
  let selectedPhoneNumberId: string | null = null;

  if (selectedNumber.success && selectedNumber.data) {
    outboundNumber = selectedNumber.data.number;
    selectedPhoneNumberId = selectedNumber.data.phoneNumberId;
  } else {
    // Fallback to global env var
    if (!voiceEnv.TELNYX_OUTBOUND_PHONE_NUMBER) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'No outbound phone number configured. Please contact support.'
        )
      );
    }
    outboundNumber = voiceEnv.TELNYX_OUTBOUND_PHONE_NUMBER;
  }

  try {
    const normalizedPhone = normalizePhoneNumber(to);

    // Create Telnyx AI service
    const telnyxAiService = createTelnyxAiService(
      voiceEnv.TELNYX_API_KEY ?? '',
      voiceEnv.ELEVENLABS_DEFAULT_VOICE_ID,
      undefined,
      voiceEnv.TELNYX_ELEVENLABS_API_KEY_REF,
      voiceEnv.TELNYX_LLM_API_KEY_REF
    );

    // Build assistant config from voice script data
    const assistantConfig = telnyxAiService.buildScriptAssistantConfig({
      scriptName: script.name,
      script: script.script,
      qualificationQuestions: script.qualificationQuestions ?? [],
      initialMessage: script.initialMessage,
      orgName: org.name,
      agentConfig: script.agentConfig as {
        voice?: string;
        language?: string;
        maxDurationSeconds?: number;
        maxCallDuration?: number;
      } | null,
      toolsWebhookUrl: voiceEnv.VOICE_TOOLS_WEBHOOK_URL ?? '',
    });

    // JIT sync: create or update the Telnyx assistant
    const assistantId = await telnyxAiService.ensureAssistantSynced(
      script.voiceProviderAgentId,
      assistantConfig
    );

    // Store assistant ID back to voice script if it's new/changed
    if (assistantId !== script.voiceProviderAgentId) {
      await db
        .update(voiceScript)
        .set({ voiceProviderAgentId: assistantId })
        .where(eq(voiceScript.id, script.id));
    }

    // Create the outbound call via TeXML
    const callResult = await telnyxAiService.createOutboundCall(
      voiceEnv.TELNYX_TEXML_APP_ID ?? '',
      {
        From: outboundNumber,
        To: normalizedPhone,
        AIAssistantId: assistantId,
        AIAssistantDynamicVariables: {
          // Sample lead data for test call
          __leadFirstName: 'Test',
          __leadLastName: 'User',
          __leadFullName: 'Test User',
          __isTestCall: 'true',
          __organizationId: organizationId,
          __agentConfigId: agentConfigId,
        },
      }
    );

    // Create voiceCall record for test call
    if (callResult.call_control_id) {
      await db.insert(voiceCall).values({
        id: callResult.call_control_id,
        leadId: null,
        agentId: script.id,
        phoneNumberId: selectedPhoneNumberId,
        status: 'in_progress',
        fromNumber: outboundNumber,
        toNumber: normalizedPhone,
        startedAt: new Date(),
        metadata: {
          isTestCall: true,
          organizationId,
          agentConfigId,
          callSessionId: callResult.call_session_id,
        },
      });
    }

    return ok({
      success: true,
      callControlId: callResult.call_control_id ?? undefined,
      message: `Test call initiated. You should receive a call at ${normalizedPhone} shortly.`,
    });
  } catch (error) {
    logError('sequences.testCall', error, {
      feature: 'sequences',
      extra: { to, agentConfigId },
    });

    const message =
      error instanceof Error ? error.message : 'Failed to initiate test call';
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, message));
  }
};

export const testCall = (db: DbConnection, input: TestCallInput) =>
  trackedResult('sequences.testCall', () => testCallImpl(db, input), {
    properties: { agentConfigId: input.agentConfigId },
  });

export type TestCallServiceResult = Awaited<ReturnType<typeof testCall>>;
