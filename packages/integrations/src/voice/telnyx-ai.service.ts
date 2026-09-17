/**
 * Telnyx AI Assistants Service
 *
 * Service for managing Telnyx AI assistants and making outbound calls.
 * Uses JIT (just-in-time) sync: creates/updates the Telnyx assistant at call time,
 * then makes the outbound call via the TeXML endpoint with the assistant ID.
 *
 * @see https://developers.telnyx.com/api/ai-assistants
 */

import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import type {
  BackgroundAudioConfig,
  BusinessContext,
  CallGoal,
  CreateAssistantOptions,
  CreateOutboundCallResult,
  CreateTexmlCallOptions,
  TelnyxAssistantResponse,
  TelnyxToolDefinition,
  TelnyxVoiceSettings,
  VoiceCallConfig,
} from './telnyx-ai.types.js';

const TELNYX_API_BASE = 'https://api.telnyx.com';

export class TelnyxAiService {
  private apiKey: string;
  readonly defaultVoiceId: string;
  private defaultBackgroundAudio: BackgroundAudioConfig;
  private elevenLabsApiKeyRef?: string;
  private llmApiKeyRef?: string;

  constructor(
    apiKey: string,
    defaultVoiceId = '21m00Tcm4TlvDq8ikWAM',
    defaultBackgroundAudio?: BackgroundAudioConfig,
    elevenLabsApiKeyRef?: string,
    llmApiKeyRef?: string
  ) {
    this.apiKey = apiKey;
    this.defaultVoiceId = defaultVoiceId;
    this.defaultBackgroundAudio = defaultBackgroundAudio ?? {
      type: 'predefined_media',
      value: 'office',
    };
    this.elevenLabsApiKeyRef = elevenLabsApiKeyRef;
    this.llmApiKeyRef = llmApiKeyRef;
  }

  // ============================================================================
  // HTTP Helper
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${TELNYX_API_BASE}${path}`;

    // TODO: Remove debug logging after Telnyx integration is verified
    if (body) {
      console.log(
        `[TelnyxAI] ${method} ${path}`,
        JSON.stringify(body, null, 2)
      );
    }

    const fetchOpts = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 15000,
    };

    // GET is a read (safe to retry); POST/PATCH/DELETE mutate (timeout only).
    const response =
      method === 'GET'
        ? await fetchWithRetry(url, fetchOpts)
        : await fetchWithTimeout(url, fetchOpts);

    if (!response.ok) {
      const errorText = await response.text();
      throw new TelnyxApiError(
        `Telnyx AI API error: ${response.status} ${response.statusText} - ${errorText}`,
        response.status
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // Assistant CRUD
  // ============================================================================

  /**
   * Create a new Telnyx AI Assistant
   */
  async createAssistant(
    options: CreateAssistantOptions
  ): Promise<TelnyxAssistantResponse> {
    return this.request<TelnyxAssistantResponse>(
      'POST',
      '/v2/ai/assistants',
      options
    );
  }

  /**
   * Update an existing Telnyx AI Assistant.
   * Note: Telnyx uses POST for updates (not PATCH).
   */
  async updateAssistant(
    id: string,
    options: Partial<CreateAssistantOptions>
  ): Promise<TelnyxAssistantResponse> {
    return this.request<TelnyxAssistantResponse>(
      'POST',
      `/v2/ai/assistants/${id}`,
      options
    );
  }

  /**
   * JIT sync: ensure the Telnyx assistant exists and is up-to-date.
   *
   * - If existingAssistantId is null → creates a new assistant
   * - If existingAssistantId exists → updates it
   * - If update returns 404 (deleted in Telnyx) → falls back to create
   *
   * @returns The assistant ID (new or existing)
   */
  private extractAssistantId(response: TelnyxAssistantResponse): string {
    const id = response.id ?? response.data?.id;
    if (!id) {
      throw new TelnyxApiError(
        'Telnyx API returned no assistant ID in response',
        500
      );
    }
    return id;
  }

  async ensureAssistantSynced(
    existingAssistantId: string | null,
    config: CreateAssistantOptions
  ): Promise<string> {
    if (!existingAssistantId) {
      const response = await this.createAssistant(config);
      return this.extractAssistantId(response);
    }

    try {
      await this.updateAssistant(existingAssistantId, config);
      return existingAssistantId;
    } catch (error) {
      // If assistant was deleted in Telnyx, fall back to create
      if (error instanceof TelnyxApiError && error.statusCode === 404) {
        const response = await this.createAssistant(config);
        return this.extractAssistantId(response);
      }
      throw error;
    }
  }

  // ============================================================================
  // Outbound Call Management (TeXML)
  // ============================================================================

  /**
   * Create an outbound phone call via the TeXML AI endpoint.
   * Requires a pre-created assistant ID.
   *
   * @param texmlAppId - The TeXML application ID from Telnyx portal
   * @param options - Call options including From, To, AIAssistantId
   */
  async createOutboundCall(
    texmlAppId: string,
    options: CreateTexmlCallOptions
  ): Promise<CreateOutboundCallResult> {
    const result = await this.request<{ data: CreateOutboundCallResult }>(
      'POST',
      `/v2/texml/ai_calls/${texmlAppId}`,
      options
    );
    return result.data;
  }

  // ============================================================================
  // High-Level Voice Call API
  // ============================================================================

  /**
   * Initiate a voice call with full business context.
   *
   * Expects the assistant to be already synced (via ensureAssistantSynced).
   * Builds TeXML call options with dynamic variables for lead context.
   */
  async initiateVoiceCall(
    config: VoiceCallConfig,
    assistantId: string,
    texmlAppId: string,
    fromNumber: string
  ): Promise<CreateOutboundCallResult> {
    const dynamicVariables = this.buildDynamicVariables(config);

    return this.createOutboundCall(texmlAppId, {
      From: fromNumber,
      To: config.lead.phoneNumber ?? '',
      AIAssistantId: assistantId,
      AIAssistantDynamicVariables: {
        ...dynamicVariables,
        // Pass metadata as dynamic variables for retrieval in webhooks
        __leadId: config.lead.leadId,
        __businessType: config.business.businessType,
        __goal: config.goal.type,
        __calendarProvider: config.calendarProvider?.type ?? '',
      },
    });
  }

  /**
   * Build dynamic variables from call configuration
   */
  buildDynamicVariables(config: VoiceCallConfig): Record<string, string> {
    const { business, lead, goal } = config;

    return {
      // Business context
      business_name: business.businessName,
      business_type: business.businessType,
      services: business.services.join(', '),
      current_offers: business.currentOffers?.join(', ') ?? '',
      operating_hours: business.operatingHours ?? '',
      business_address: business.address ?? '',
      special_instructions: business.specialInstructions ?? '',

      // Lead context
      lead_first_name: lead.firstName,
      lead_last_name: lead.lastName ?? '',
      lead_full_name: `${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ''}`,
      interested_service: lead.interestedService ?? '',
      interested_offer: lead.interestedOffer ?? '',
      previous_interactions: lead.previousInteractions ?? '',
      preferred_time: lead.preferredTime ?? '',
      lead_notes: lead.notes ?? '',

      // Goal context
      goal_type: goal.type,
      goal_description: goal.description,
      success_criteria: goal.successCriteria?.join('; ') ?? '',
      fallback_action: goal.fallbackAction,
    };
  }

  // ============================================================================
  // Prompt Generation
  // ============================================================================

  /**
   * Generate a dynamic prompt based on business type and context
   */
  generatePrompt(config: VoiceCallConfig): string {
    const { business, goal } = config;

    let prompt = `You are a professional AI assistant calling on behalf of ${business.businessName}, a ${business.businessType}.

## Your Role
You are a friendly, professional voice assistant making an outbound call. Your goal is to ${goal.description}.

## Business Context
- Business Name: {{business_name}}
- Business Type: {{business_type}}
- Services Offered: {{services}}
${business.currentOffers?.length ? '- Current Offers: {{current_offers}}' : ''}
${business.operatingHours ? '- Operating Hours: {{operating_hours}}' : ''}
${business.address ? '- Location: {{business_address}}' : ''}
${business.specialInstructions ? '\n## Special Instructions\n{{special_instructions}}' : ''}

## Lead Information
- Name: {{lead_full_name}}
${config.lead.interestedService ? '- Interested in: {{interested_service}}' : ''}
${config.lead.interestedOffer ? '- Interested offer: {{interested_offer}}' : ''}
${config.lead.previousInteractions ? '- Previous interactions: {{previous_interactions}}' : ''}
${config.lead.preferredTime ? '- Preferred time: {{preferred_time}}' : ''}

## Call Objective
${goal.description}
${goal.successCriteria?.length ? `\n### Success Criteria\n${goal.successCriteria.map((c) => `- ${c}`).join('\n')}` : ''}

## Conversation Guidelines
1. Start by greeting the lead by name and introducing yourself as calling from {{business_name}}
2. Be warm, professional, and conversational - not robotic
3. Listen actively and respond to questions naturally
4. If the lead seems busy, offer to call back at a better time
5. If you cannot help with something, ${this.getFallbackInstruction(goal.fallbackAction)}

## Important Rules
- Never be pushy or aggressive
- Respect if the lead says they're not interested
- Keep the conversation focused but natural
- If asked a question you can't answer, honestly say you'll have someone follow up
`;

    // Add business-type specific instructions
    prompt += this.getBusinessTypeInstructions(business.businessType, goal);

    return prompt;
  }

  /**
   * Get fallback instruction based on action type
   */
  private getFallbackInstruction(
    fallbackAction: CallGoal['fallbackAction']
  ): string {
    switch (fallbackAction) {
      case 'schedule_callback':
        return 'offer to schedule a callback from a team member who can better assist';
      case 'transfer_to_human':
        return 'transfer the call to a human representative';
      case 'send_sms':
        return "let them know you'll send more information via text message";
      case 'end_call':
        return 'thank them for their time and end the call politely';
    }
  }

  /**
   * Get business-type specific instructions
   */
  private getBusinessTypeInstructions(
    businessType: BusinessContext['businessType'],
    goal: CallGoal
  ): string {
    const instructions: Record<BusinessContext['businessType'], string> = {
      clinic: `
## Clinic-Specific Guidelines
- Always ask about their health concern briefly to understand urgency
- Mention that you can help book a consultation with the appropriate specialist
- If it sounds urgent, recommend they visit sooner or call the clinic directly
- Be empathetic about health concerns
${goal.type === 'book_appointment' ? '- When booking, confirm the patient name, preferred date/time, and type of consultation needed' : ''}
`,
      dental: `
## Dental Practice Guidelines
- Ask about the type of appointment needed (checkup, cleaning, specific concern)
- Mention any new patient specials if applicable
- Be reassuring - many people have dental anxiety
${goal.type === 'book_appointment' ? '- When booking, ask if they have a preferred dentist or are seeing anyone new' : ''}
`,
      salon: `
## Salon Guidelines
- Ask about the specific service they're interested in (haircut, color, styling, etc.)
- Mention if specific stylists specialize in certain services
- Be upbeat and friendly
${goal.type === 'book_appointment' ? '- When booking, ask if they have a preferred stylist or time of day' : ''}
`,
      spa: `
## Spa Guidelines
- Create a relaxing tone in your voice
- Ask about the type of treatment they're interested in
- Mention any packages or special offers
${goal.type === 'book_appointment' ? '- When booking, ask about any specific preferences or health considerations' : ''}
`,
      veterinary: `
## Veterinary Clinic Guidelines
- Ask about their pet (type, name, age if relevant)
- Be warm and show care for the pet's wellbeing
- If it sounds like an emergency, recommend they come in right away
${goal.type === 'book_appointment' ? "- When booking, confirm the pet's name and reason for visit" : ''}
`,
      fitness: `
## Fitness Center Guidelines
- Be energetic and motivating
- Ask about their fitness goals
- Mention trial sessions or introductory offers
${goal.type === 'book_appointment' ? '- When booking, ask about their experience level and preferred workout times' : ''}
`,
      consulting: `
## Consulting Business Guidelines
- Be professional and knowledgeable
- Ask about their specific needs or challenges
- Emphasize the value of the consultation
${goal.type === 'book_appointment' ? '- When booking, ask about the main topics they want to discuss' : ''}
`,
      other: `
## General Business Guidelines
- Be professional and helpful
- Ask relevant questions to understand their needs
- Provide helpful information about services
`,
    };

    return instructions[businessType];
  }

  // ============================================================================
  // Tool Definitions
  // ============================================================================

  /**
   * Generate tool definitions for a Telnyx AI assistant.
   * These tools are executed via webhook during calls.
   */
  generateToolDefinitions(toolsWebhookUrl: string): TelnyxToolDefinition[] {
    return [
      {
        type: 'webhook',
        webhook: {
          name: 'check_availability',
          description:
            'Check available appointment slots for the requested date range',
          url: toolsWebhookUrl,
          method: 'POST',
          body_parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description:
                  'The date to check availability for (YYYY-MM-DD format)',
              },
              service_type: {
                type: 'string',
                description: 'The type of service/appointment needed',
              },
              preferred_time: {
                type: 'string',
                description:
                  "Preferred time of day: 'morning', 'afternoon', or 'evening'",
                enum: ['morning', 'afternoon', 'evening', 'any'],
              },
            },
            required: ['date'],
          },
        },
      },
      {
        type: 'webhook',
        webhook: {
          name: 'book_appointment',
          description: 'Book an appointment at the specified date and time',
          url: toolsWebhookUrl,
          method: 'POST',
          body_parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'The appointment date (YYYY-MM-DD format)',
              },
              time: {
                type: 'string',
                description: 'The appointment time (HH:MM format, 24-hour)',
              },
              service_type: {
                type: 'string',
                description: 'The type of service/appointment',
              },
              customer_name: {
                type: 'string',
                description: 'Full name of the customer',
              },
              customer_phone: {
                type: 'string',
                description: 'Phone number of the customer',
              },
              customer_email: {
                type: 'string',
                description: 'Email address of the customer (optional)',
              },
              notes: {
                type: 'string',
                description: 'Any additional notes for the appointment',
              },
            },
            required: ['date', 'time', 'customer_name', 'customer_phone'],
          },
        },
      },
      {
        type: 'webhook',
        webhook: {
          name: 'schedule_callback',
          description:
            'Schedule a callback from a human team member when AI cannot assist',
          url: toolsWebhookUrl,
          method: 'POST',
          body_parameters: {
            type: 'object',
            properties: {
              preferred_time: {
                type: 'string',
                description:
                  'When the customer prefers to receive the callback',
              },
              reason: {
                type: 'string',
                description: 'Brief reason for the callback request',
              },
              urgency: {
                type: 'string',
                description: 'How urgent is the callback',
                enum: ['low', 'medium', 'high'],
              },
            },
            required: ['reason'],
          },
        },
      },
      {
        type: 'webhook',
        webhook: {
          name: 'transfer_to_human',
          description:
            'Request transfer to a human representative when the caller needs specialized help',
          url: toolsWebhookUrl,
          method: 'POST',
          body_parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Reason for the transfer request',
              },
            },
            required: ['reason'],
          },
        },
      },
    ];
  }

  // ============================================================================
  // Assistant Config Builders
  // ============================================================================

  /**
   * Build a full assistant configuration matching the Telnyx API schema.
   * Maps to POST /v2/ai/assistants request body.
   */
  buildAssistantConfig(
    name: string,
    prompt: string,
    greeting: string,
    voiceId: string,
    toolsWebhookUrl: string,
    _maxDurationSeconds?: number,
    language?: string
  ): CreateAssistantOptions {
    const voiceSettings: TelnyxVoiceSettings = {
      voice: `ElevenLabs.${voiceId}`,
      background_audio: this.defaultBackgroundAudio,
    };

    // Add ElevenLabs API key ref if configured
    if (this.elevenLabsApiKeyRef) {
      voiceSettings.api_key_ref = this.elevenLabsApiKeyRef;
    }

    return {
      name,
      instructions: prompt,
      model: 'openai/gpt-4o',
      greeting,
      llm_api_key_ref: this.llmApiKeyRef,
      voice_settings: voiceSettings,
      telephony_settings: undefined,
      transcription: language ? { language } : undefined,
      enabled_features: ['telephony'],
      tools: this.generateToolDefinitions(toolsWebhookUrl),
    };
  }

  /**
   * Build the full instructions prompt from a voice script's data.
   */
  buildInstructionsFromScript(
    script: string | null,
    qualificationQuestions: string[],
    orgName: string
  ): string {
    if (script?.trim()) {
      if (qualificationQuestions.length > 0) {
        return `${script}

## Qualification Questions
Ask these questions to qualify the lead:
${qualificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
      }
      return script;
    }

    return `You are a friendly and professional AI assistant calling on behalf of ${orgName}.

## Your Role
You are making outbound calls to leads who have expressed interest in our services. Your goal is to qualify them and book appointments.

## Guidelines
1. Start by greeting the lead warmly by name
2. Confirm their interest in our services
3. Ask the qualification questions to understand their needs
4. If qualified, offer to book an appointment
5. Be conversational and natural, not robotic
6. If they're busy, offer to call back at a better time
7. Always be respectful if they decline

${
  qualificationQuestions.length > 0
    ? `## Qualification Questions
Ask these questions to qualify the lead:
${qualificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : ''
}

## Important Rules
- Never be pushy or aggressive
- Respect if the lead says they're not interested
- If you can't answer a question, offer to have someone follow up`;
  }

  /**
   * Build a complete assistant config from voice script data.
   * Used for JIT sync — config is built at call time and synced to Telnyx
   * via ensureAssistantSynced before making the outbound call.
   */
  buildScriptAssistantConfig(params: {
    scriptName: string;
    script: string | null;
    qualificationQuestions: string[];
    initialMessage: string | null;
    orgName: string;
    agentConfig?: {
      voice?: string;
      language?: string;
      maxDurationSeconds?: number;
      maxCallDuration?: number;
    } | null;
    toolsWebhookUrl: string;
  }): CreateAssistantOptions {
    const prompt = this.buildInstructionsFromScript(
      params.script,
      params.qualificationQuestions,
      params.orgName
    );

    const voiceId = params.agentConfig?.voice ?? this.defaultVoiceId;
    const language = params.agentConfig?.language;
    const maxDuration =
      params.agentConfig?.maxDurationSeconds ??
      params.agentConfig?.maxCallDuration;

    return this.buildAssistantConfig(
      params.scriptName || `${params.orgName} Voice Agent`,
      prompt,
      params.initialMessage ?? `Hello! I'm calling from ${params.orgName}.`,
      voiceId,
      params.toolsWebhookUrl,
      maxDuration,
      language
    );
  }
}

/**
 * Custom error class for Telnyx API errors with status code
 */
export class TelnyxApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TelnyxApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Create a TelnyxAiService instance
 */
export function createTelnyxAiService(
  apiKey: string,
  defaultVoiceId?: string,
  backgroundAudio?: BackgroundAudioConfig,
  elevenLabsApiKeyRef?: string,
  llmApiKeyRef?: string
): TelnyxAiService {
  return new TelnyxAiService(
    apiKey,
    defaultVoiceId,
    backgroundAudio,
    elevenLabsApiKeyRef,
    llmApiKeyRef
  );
}
