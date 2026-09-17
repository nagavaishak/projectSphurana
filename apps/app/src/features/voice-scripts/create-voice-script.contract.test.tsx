import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /voice-scripts` — create the org's voice script.
 *
 * Two surfaces create one, from opposite ends:
 *
 *   - the ai-assistant VOICE PANEL — the operator picks a voice + language; with
 *     no script on the org yet the panel creates one, seeding the opener from a
 *     constant (it does not edit copy). It owns those two fields.
 *   - the onboarding STEP-3 EDITOR — auto-creates the org's default script on
 *     MOUNT, entirely from constants, before the user has typed anything. It is a
 *     FIELD-LESS surface (`owns: []`): it fills nothing, and its body is still
 *     asserted in full.
 *
 * They send disjoint key sets (and different openers) by design, so ownership —
 * not one shared body — is what they agree on. Both go through the one
 * `buildCreateVoiceScriptPayload`.
 */

// Radix (select, popover) needs these in jsdom.
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

import {
  DEFAULT_FOLLOW_UP,
  DEFAULT_INITIAL_MESSAGE,
  DEFAULT_SCRIPT,
  Step3VoiceScript,
} from '@/features/integrations-dashboard/components/tabs/step-3-voice-script';
import {
  VOICE_PANEL_DEFAULT_INITIAL_MESSAGE,
  VoicePanel,
} from '@/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/voice-panel';
import { createVoiceScriptForm } from './api/create-voice-script/create-voice-script.form';

const ORG_ID = 'org-1';

const readCreateBody = () => {
  const call = post.mock.calls.find((c) => c[0] === 'voice-scripts');
  if (!call) throw new Error('no POST voice-scripts call captured');
  return call[1] as Record<string, unknown>;
};

const reset = () => {
  post.mockReset();
  post.mockResolvedValue({ id: 'vs-1' });
  put.mockReset();
  put.mockResolvedValue({ id: 'vs-1' });
  get.mockReset();
  // No default script exists yet — both surfaces then create one.
  get.mockResolvedValue(null);
};

runFormContract({
  operation: 'POST voice-scripts',
  description: 'Create voice script',
  form: createVoiceScriptForm,

  surfaces: [
    {
      name: 'ai-assistant voice-panel (no script yet)',
      owns: ['voice', 'language'],
      run: async (ctx) => {
        renderWithProviders(
          <VoicePanel
            organizationId={ORG_ID}
            voiceScript={null}
            isLoading={false}
          />
        );
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save voice/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'onboarding step-3 editor (auto-create)',
      // Field-less: this body is seeded from constants on mount, before the user
      // has typed anything. Its FORM writes the debounced PUT, contracted in
      // update-voice-script.contract.
      owns: [],
      run: async () => {
        renderWithProviders(<Step3VoiceScript organizationId={ORG_ID} />);
        await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      },
    },
  ],

  reset,
  readBody: readCreateBody,

  expectedBody: (surface) => {
    if (surface.name === 'onboarding step-3 editor (auto-create)') {
      // The seed, exactly — including `script`, which the API DTO used to drop
      // silently and the shared builder now carries.
      return {
        name: 'Default Script',
        isDefault: true,
        initialMessage: DEFAULT_INITIAL_MESSAGE,
        script: DEFAULT_SCRIPT,
        qualificationQuestions: [],
        followUps: [DEFAULT_FOLLOW_UP],
      };
    }
    // The panel's two picks fold into the nested `agentConfig`; the opener is its
    // own constant (it has no control for it — see the form's `exempt`).
    return {
      // The panel sets none of these, so the canonical request contract's
      // `.default()`s MATERIALISE them into the parsed body — the same values
      // the server would have applied, now visible on the wire.
      name: 'Default Script',
      isDefault: true,
      qualificationQuestions: [],
      followUps: [],
      ...expectedFromFields(
        createVoiceScriptForm.fields,
        {
          initialMessage: VOICE_PANEL_DEFAULT_INITIAL_MESSAGE,
          agentConfig: { voice: 'EXAVITQu4vr4xnSDxMaL', language: 'es' },
        },
        { only: surface.owns }
      ),
    };
  },
});
