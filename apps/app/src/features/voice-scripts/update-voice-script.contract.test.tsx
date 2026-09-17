import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /voice-scripts/:id` — update the org's voice script.
 *
 * ONE form, THREE surfaces, each owning a disjoint slice of the same resource:
 *
 *   - the ai-assistant VOICE PANEL    → `voice` + `language` (the `agentConfig`)
 *   - the ai-assistant DIRECTIVE CARD → `script`, mirrored from the chatbot
 *     directive so one instruction governs chat and voice
 *   - the onboarding STEP-3 EDITOR    → the content (opener, agent script,
 *     qualification questions, follow-ups), autosaved on a 2s debounce
 *
 * A partial PUT is the design, so the three bodies are legitimately different —
 * ownership declares who must render what. What the harness still holds: every
 * field is owned by SOMEONE, and `script`, which the directive card and the
 * onboarding editor BOTH write, must be encoded identically by both (property 4).
 * It used to be hand-built at each call site, and the API DTO dropped it silently.
 */

// Radix (dialog, select, popover) needs these in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    get: (...args: unknown[]) => get(...args),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The directive card also saves chatbot settings; that is a different operation.
vi.mock('@/features/chatbots/api', () => ({
  useUpdateChatbotSettings: () => ({
    updateChatbotSettings: vi.fn(),
    isUpdating: false,
  }),
}));

// The test-chat lives behind a dialog trigger; keep its dependency graph out.
vi.mock(
  '@/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/chatbot-test-chat',
  () => ({ ChatbotTestChat: () => null })
);

import { Step3VoiceScript } from '@/features/integrations-dashboard/components/tabs/step-3-voice-script';
import { DirectiveCard } from '@/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/directive-card';
import { VoicePanel } from '@/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/voice-panel';
import type { VoiceScript } from './api/types';
import {
  DIRECTIVE_LABEL,
  updateVoiceScriptForm,
} from './api/update-voice-script/update-voice-script.form';

const ORG_ID = 'org-1';
const SCRIPT_ID = 'vs-1';
/** The `script` field's sample — typed by BOTH surfaces that write it. */
const SCRIPT_SAMPLE = 'You are a warm clinic assistant. Book appointments.';

const savedScript: VoiceScript = {
  id: SCRIPT_ID,
  organizationId: ORG_ID,
  name: 'Default Script',
  isDefault: true,
  initialMessage: 'Hi there',
  script: 'existing script',
  qualificationQuestions: [],
  followUps: [],
  voiceProviderAgentId: null,
  agentConfig: { voice: '21m00Tcm4TlvDq8ikWAM', language: 'en' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as VoiceScript;

runFormContract({
  operation: 'PUT voice-scripts/:id',
  description: 'Update voice script',
  form: updateVoiceScriptForm,

  surfaces: [
    {
      name: 'ai-assistant voice-panel',
      owns: ['voice', 'language'],
      run: async (ctx) => {
        renderWithProviders(
          <VoicePanel
            organizationId={ORG_ID}
            voiceScript={savedScript}
            isLoading={false}
          />
        );
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save voice/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      name: 'ai-assistant directive-card',
      owns: ['script'],
      // The card writes `script` through its OWN control — the chatbot's label,
      // single-sourced from `DIRECTIVE_LABEL`, which the card renders.
      fills: {
        script: async (user: UserEvent) => {
          const box = screen.getByLabelText(
            new RegExp(`^\\s*${DIRECTIVE_LABEL}\\s*$`, 'i')
          );
          await user.clear(box);
          await user.type(box, SCRIPT_SAMPLE);
        },
      },
      run: async (ctx) => {
        renderWithProviders(
          <DirectiveCard
            organizationId={ORG_ID}
            chatbotSystemPrompt={null}
            voiceScript={savedScript}
          />
        );
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      name: 'onboarding step-3 editor',
      owns: ['initialMessage', 'script', 'qualificationQuestions', 'followUps'],
      fills: {
        // The question / follow-up rows are a sortable list of unlabelled
        // textareas; an empty row is always present, so type into it.
        qualificationQuestions: async (user: UserEvent) => {
          await user.type(
            screen.getByPlaceholderText(/enter qualification question/i),
            'What treatment are you interested in?'
          );
        },
        followUps: async (user: UserEvent) => {
          const row = screen.getByPlaceholderText(/enter follow-up message/i);
          await user.clear(row);
          await user.type(row, 'Just checking you got this!');
        },
      },
      run: async (ctx) => {
        renderWithProviders(<Step3VoiceScript organizationId={ORG_ID} />);
        // The editor loads the org's default script and seeds itself from it.
        await waitFor(() =>
          expect(screen.getByLabelText(/^\s*AI Agent Script\s*$/i)).toHaveValue(
            savedScript.script ?? ''
          )
        );

        await ctx.fillRest();

        // There is no save button: the editor autosaves 2s after the last edit.
        await waitFor(() => expect(put).toHaveBeenCalled(), {
          timeout: 10_000,
        });
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue(savedScript);
    post.mockReset();
    post.mockResolvedValue(savedScript);
    get.mockReset();
    get.mockResolvedValue(savedScript);
  },

  readBody: () => {
    const call = put.mock.calls.find(
      (c) => c[0] === `voice-scripts/${SCRIPT_ID}`
    );
    if (!call) throw new Error(`no PUT voice-scripts/${SCRIPT_ID} captured`);
    return call[1] as Record<string, unknown>;
  },

  // Each surface patches only what it owns. The voice panel's two picks fold into
  // the nested `agentConfig`; the onboarding editor stamps the name of the org's
  // one default script (both fields `exempt` — no control, by design).
  expectedBody: (surface) => {
    const only = surface.owns;
    const fields = updateVoiceScriptForm.fields;

    if (surface.name === 'ai-assistant voice-panel') {
      return expectedFromFields(
        fields,
        { agentConfig: { voice: 'EXAVITQu4vr4xnSDxMaL', language: 'es' } },
        { only }
      );
    }
    if (surface.name === 'onboarding step-3 editor') {
      return expectedFromFields(
        fields,
        { name: 'Default Script', isDefault: true },
        { only }
      );
    }
    // Directive card: just `script`, trimmed — and the sample is already trimmed.
    return expectedFromFields(fields, {}, { only });
  },
});
