import {
  organization,
  voiceCall,
  voiceScript,
} from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import { createTelnyxAiService } from '@borradh-workspace/integrations';
import type {
  BusinessType,
  CallGoal,
  VoiceCallConfig,
} from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { BillingErrorCodes } from '../../../billing/models/billing-error.types.js';
import type { CreditChannel } from '../../../billing/models/billing.types.js';
import { useCredits } from '../../../billing/services/use-credits/use-credits.service.js';
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
import type {
  ExecutionResultData,
  LeadData,
  SequenceStep,
  VoiceCallNodeConfig,
} from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Execute a voice call step
 */
export async function executeVoiceStep(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  const voiceConfig = step.config as unknown as VoiceCallNodeConfig;

  // Validate phone number exists
  if (!leadData.phone) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Lead does not have a phone number'
      )
    );
  }

  // Resolve voice script from DB
  const voiceScriptId = voiceConfig.agentConfigId;
  if (!voiceScriptId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Voice call step is missing agent configuration'
      )
    );
  }

  const script = await db.query.voiceScript.findFirst({
    where: eq(voiceScript.id, voiceScriptId),
  });

  if (!script) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Voice script not found')
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

  // Select phone number from pool (with lead affinity) or fall back to global env var
  const selectedNumber = await selectPhoneNumber(db, {
    organizationId,
    leadId: leadData.id,
  });

  let outboundNumber: string;
  let selectedPhoneNumberId: string | null = null;

  if (selectedNumber.success && selectedNumber.data) {
    outboundNumber = selectedNumber.data.number;
    selectedPhoneNumberId = selectedNumber.data.phoneNumberId;
  } else {
    // Fallback to global env var
    const envOutboundNumber = voiceEnv.TELNYX_OUTBOUND_PHONE_NUMBER;
    if (!envOutboundNumber) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'No phone numbers available and TELNYX_OUTBOUND_PHONE_NUMBER is not set'
        )
      );
    }
    outboundNumber = envOutboundNumber;
  }

  // Deduct credits before initiating call (charge 1 minute minimum upfront)
  // Note: Additional minutes should be charged via webhook when call completes
  const voiceCreditResult = await useCredits(db, {
    organizationId,
    channel: 'voice' as CreditChannel,
    quantity: 1, // 1 minute minimum
    referenceId: step.id,
    referenceType: 'sequence_step',
    description: `Voice call to lead ${leadData.id}`,
  });

  if (!voiceCreditResult.success) {
    logger.warn('Insufficient credits for voice call', {
      leadId: leadData.id,
      organizationId,
      error: voiceCreditResult.error.code,
    });
    return err(
      new FeatureError(
        voiceCreditResult.error.code === BillingErrorCodes.INSUFFICIENT_CREDITS
          ? ErrorCodes.FORBIDDEN
          : ErrorCodes.INTERNAL_ERROR,
        voiceCreditResult.error.message
      )
    );
  }

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

  // Build voice call configuration
  const callConfig: VoiceCallConfig = {
    business: {
      businessType: (voiceConfig.businessType ?? 'other') as BusinessType,
      businessName: voiceConfig.businessName ?? org.name,
      services: voiceConfig.services ?? [],
      currentOffers: voiceConfig.currentOffers,
      operatingHours: voiceConfig.operatingHours,
      address: voiceConfig.address,
      specialInstructions: voiceConfig.specialInstructions,
    },
    lead: {
      leadId: leadData.id,
      firstName: leadData.firstName ?? leadData.name?.split(' ')[0] ?? 'there',
      lastName:
        leadData.lastName ?? leadData.name?.split(' ').slice(1).join(' '),
      phoneNumber: leadData.phone ?? undefined,
      interestedService:
        leadData.interestedService ?? voiceConfig.interestedService,
      interestedOffer: leadData.interestedOffer ?? voiceConfig.interestedOffer,
      notes: leadData.notes ?? undefined,
    },
    goal: {
      type: (voiceConfig.goalType ?? 'follow_up') as CallGoal['type'],
      description: voiceConfig.goalDescription ?? 'Follow up with the lead',
      fallbackAction: (voiceConfig.fallbackAction ??
        'schedule_callback') as CallGoal['fallbackAction'],
    },
    calendarProvider:
      voiceConfig.calendarProvider as VoiceCallConfig['calendarProvider'],
    maxDurationSeconds: voiceConfig.maxDurationSeconds,
    language: voiceConfig.language as VoiceCallConfig['language'],
  };

  // Initiate the voice call via Telnyx AI with JIT-synced assistant
  const callResult = await telnyxAiService.initiateVoiceCall(
    callConfig,
    assistantId,
    voiceEnv.TELNYX_TEXML_APP_ID ?? '',
    outboundNumber
  );

  // Create voiceCall record immediately
  if (callResult.call_control_id) {
    await db.insert(voiceCall).values({
      id: callResult.call_control_id,
      leadId: leadData.id,
      agentId: script.id,
      phoneNumberId: selectedPhoneNumberId,
      status: 'in_progress',
      fromNumber: outboundNumber,
      toNumber: leadData.phone,
      startedAt: new Date(),
      metadata: {
        leadId: leadData.id,
        organizationId,
        goal: voiceConfig.goalType,
        callSessionId: callResult.call_session_id,
      },
    });
  }

  return ok({
    type: 'voice_call',
    initiated: true,
    conversationId: callResult.call_control_id,
    agentId: script.id,
  });
}
