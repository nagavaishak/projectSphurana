import { describe, expect, it } from 'vitest';
import {
  type BuildPromptContextInput,
  buildPromptContext,
} from './build-prompt-context.js';

describe('buildPromptContext', () => {
  const makeInput = (
    overrides: Partial<BuildPromptContextInput> = {}
  ): BuildPromptContextInput => ({
    organization: {
      id: 'org-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
      defaultBookingLink: 'https://book.test.com',
      businessType: 'clinic',
      tagline: null,
      credibilityLine: null,
      businessHours: null,
      websiteUrl: 'https://test.com',
      primaryCalendarType: null,
      primaryCalendarAccountId: null,
      // Pinned, not omitted. An absent zone makes the date line resolve
      // against whatever machine runs the suite, so these tests would pass on
      // a laptop and mean nothing about what a real org sees.
      timezone: 'Europe/Dublin',
      chatbotSettings: { ownerName: 'Dr. Smith' },
      chatbotSystemPrompt: null,
      knowledgeBase: null,
    },
    micrositePrimaryDomain: null,
    services: [],
    locations: [],
    conversationMetadata: null,
    isReturningConversation: false,
    messageHistory: [],
    userMessage: 'Hello!',
    ...overrides,
  });

  // Regression guard (ENG-770 class): the native booking link must be built on
  // the APP host. Built from WEB_URL it pointed at www.borradh.io, whose CSP
  // `connect-src` omits the API origin — the booking page rendered and then
  // every API call was refused by the browser, so the link looked fine and did
  // nothing. There was no assertion on this link at all, which is why the
  // regression survived; do not weaken this to a substring of `/book/`.
  it('builds the native booking link on the app host, not the marketing site', () => {
    const result = buildPromptContext(
      makeInput({
        organization: {
          ...makeInput().organization,
          bookingDestination: 'borradh',
        },
      })
    );

    // Booking lives on the MICROSITE now, not the app. With no active custom
    // domain this is the path tier; a tenant with one gets their own host.
    // This assertion auto-merged from main carrying the older APP_URL shape —
    // the file was not in the conflict set, so nothing flagged it.
    expect(result.systemPrompt).toContain(
      'https://mock-marketing.example.com/sites/test-clinic/book'
    );
    expect(result.systemPrompt).not.toContain('mock-app.example.com/book');
  });

  it('should include organization name in system prompt', () => {
    const result = buildPromptContext(makeInput());
    expect(result.systemPrompt).toContain('Test Clinic');
  });

  it('injects the lead form enquiry block into the user prompt when provided', () => {
    const result = buildPromptContext(
      makeInput({
        leadEnquiry:
          'The customer submitted a lead form for "Japanese Head Spa".',
      })
    );
    expect(result.userPrompt).toContain('--- Lead Form Enquiry ---');
    expect(result.userPrompt).toContain('Japanese Head Spa');
  });

  it('omits the lead form enquiry block when not provided', () => {
    const result = buildPromptContext(makeInput());
    expect(result.userPrompt).not.toContain('Lead Form Enquiry');
  });

  it('should format services list correctly', () => {
    const result = buildPromptContext(
      makeInput({
        services: [
          {
            name: 'Botox',
            pricingDescription: '€200',
            bookingFormUrl: null,
            requiresDeposit: false,
            depositCents: null,
            appointmentDuration: 30,
            description: 'Anti-wrinkle treatment',
          },
        ],
      })
    );

    expect(result.systemPrompt).toContain('Botox');
    expect(result.systemPrompt).toContain('€200');
  });

  it('surfaces the consultation fee for a deposit-requiring service', () => {
    const result = buildPromptContext(
      makeInput({
        services: [
          {
            name: 'Skin Consultation',
            pricingDescription: '€120',
            bookingFormUrl: null,
            requiresDeposit: true,
            // Already resolved through the booking resolver, so this IS the
            // figure the customer will be charged.
            depositCents: 5000,
            appointmentDuration: 45,
            description: 'Full skin assessment',
          },
        ],
      })
    );

    // Per-service consultation fee is rendered from depositAmountCents.
    expect(result.systemPrompt).toContain('Consultation fee: €50.00');
    // A paid consultation must NOT be described as included.
    expect(result.systemPrompt).not.toContain('Consultation included');
  });

  it('sends a native-calendar org’s customers to the path tier by default', () => {
    const result = buildPromptContext(
      makeInput({
        organization: {
          ...makeInput().organization,
          primaryCalendarType: 'borradh',
          bookingDestination: 'borradh',
        },
      })
    );

    expect(result.systemPrompt).toContain(
      'https://mock-marketing.example.com/sites/test-clinic/book'
    );
  });

  it('sends a native-calendar org’s customers to THEIR host once its domain is live', () => {
    const result = buildPromptContext(
      makeInput({
        micrositePrimaryDomain: 'glowaesthetics.ie',
        organization: {
          ...makeInput().organization,
          primaryCalendarType: 'borradh',
          bookingDestination: 'borradh',
        },
      })
    );

    expect(result.systemPrompt).toContain('https://glowaesthetics.ie/book');
    expect(result.systemPrompt).not.toContain('mock-web.example.com');
  });

  it('should include booking URLs when available', () => {
    const result = buildPromptContext(
      makeInput({
        services: [
          {
            name: 'Filler',
            pricingDescription: null,
            bookingFormUrl: 'https://book.test.com/filler',
            requiresDeposit: false,
            depositCents: null,
            appointmentDuration: null,
            description: null,
          },
        ],
      })
    );

    expect(result.systemPrompt).toContain('https://book.test.com/filler');
  });

  it('should format message history in correct order', () => {
    const result = buildPromptContext(
      makeInput({
        messageHistory: [
          { role: 'user', content: 'Hi there' },
          { role: 'bot', content: 'Hey! How can I help?' },
        ],
        userMessage: 'How much is botox?',
      })
    );

    expect(result.userPrompt).toContain('Customer: Hi there');
    expect(result.userPrompt).toContain('Assistant: Hey! How can I help?');
    expect(result.userPrompt).toContain('Customer: How much is botox?');

    // Order should be preserved
    const hiIndex = result.userPrompt.indexOf('Customer: Hi there');
    const helpIndex = result.userPrompt.indexOf(
      'Assistant: Hey! How can I help?'
    );
    const botoxIndex = result.userPrompt.indexOf(
      'Customer: How much is botox?'
    );
    expect(hiIndex).toBeLessThan(helpIndex);
    expect(helpIndex).toBeLessThan(botoxIndex);
  });

  it('should format agent messages as "Human Agent:" in history', () => {
    const result = buildPromptContext(
      makeInput({
        messageHistory: [
          { role: 'user', content: 'Hi' },
          { role: 'agent', content: 'Hey, I can help with that' },
          { role: 'user', content: 'Thanks!' },
        ],
        userMessage: 'One more question',
      })
    );

    expect(result.userPrompt).toContain(
      'Human Agent: Hey, I can help with that'
    );
    expect(result.userPrompt).not.toContain(
      'Assistant: Hey, I can help with that'
    );
  });

  it('should distinguish bot and agent messages in mixed history', () => {
    const result = buildPromptContext(
      makeInput({
        messageHistory: [
          { role: 'user', content: 'Hi' },
          { role: 'bot', content: 'Hey, I am the receptionist' },
          { role: 'user', content: 'Can I speak to someone?' },
          { role: 'agent', content: 'Hi, this is the owner' },
        ],
        userMessage: 'Thanks for that',
      })
    );

    expect(result.userPrompt).toContain(
      'Assistant: Hey, I am the receptionist'
    );
    expect(result.userPrompt).toContain('Human Agent: Hi, this is the owner');
    expect(result.userPrompt).toContain('Customer: Hi');

    // Verify ordering
    const botIdx = result.userPrompt.indexOf(
      'Assistant: Hey, I am the receptionist'
    );
    const agentIdx = result.userPrompt.indexOf(
      'Human Agent: Hi, this is the owner'
    );
    expect(botIdx).toBeLessThan(agentIdx);
  });

  it('should handle empty message history', () => {
    const result = buildPromptContext(
      makeInput({
        messageHistory: [],
        userMessage: 'Hello!',
      })
    );

    expect(result.userPrompt).toContain('Customer: Hello!');
  });

  it('should include user display name in context when metadata has name', () => {
    const result = buildPromptContext(
      makeInput({
        conversationMetadata: { name: 'Sarah' },
      })
    );

    expect(result.userPrompt).toContain('Sarah');
    expect(result.systemPrompt).toContain('Sarah');
  });

  it('should detect calendar connected status', () => {
    const result = buildPromptContext(
      makeInput({
        organization: {
          id: 'org-1',
          name: 'Test Clinic',
          slug: 'test-clinic',
          defaultBookingLink: null,
          businessType: null,
          tagline: null,
          credibilityLine: null,
          businessHours: null,
          websiteUrl: null,
          primaryCalendarType: 'google',
          primaryCalendarAccountId: 'account-1',
          timezone: 'Europe/Dublin',
          chatbotSettings: null,
          chatbotSystemPrompt: null,
          knowledgeBase: null,
        },
      })
    );

    expect(result.calendarConnected).toBe(true);
  });

  it('should detect calendar not connected', () => {
    const result = buildPromptContext(makeInput());
    expect(result.calendarConnected).toBe(false);
  });

  it('should include conversation context for returning conversations', () => {
    const result = buildPromptContext(
      makeInput({
        isReturningConversation: true,
        conversationMetadata: {
          name: 'Sarah',
          stage: 'qualified',
          treatmentsDiscussed: ['botox'],
        },
      })
    );

    expect(result.systemPrompt).toContain('RETURNING CUSTOMER');
    expect(result.userPrompt).toContain('qualified');
    expect(result.userPrompt).toContain('botox');
  });
});
