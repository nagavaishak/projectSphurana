import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

import {
  languageField,
  voiceField,
} from '../create-voice-script/create-voice-script.form';

/**
 * The voice script, declared ONCE — and written by THREE surfaces, each owning a
 * disjoint slice of it:
 *
 *   - the ai-assistant VOICE PANEL    → `voice` + `language` (the `agentConfig`)
 *   - the ai-assistant DIRECTIVE CARD → `script`, mirrored from the chatbot
 *     directive so one instruction governs chat and voice
 *   - the onboarding STEP-3 EDITOR    → the content (opener, agent script,
 *     qualification questions, follow-ups), autosaved on a debounce
 *
 * A partial PUT is the design: `buildUpdateVoiceScriptPayload` emits only the
 * keys the surface set, so the three bodies are legitimately different. Ownership
 * is declared per surface in `update-voice-script.contract.test.tsx`, which keeps
 * the two checks that matter: every field is owned by SOMEONE (a control that
 * falls off every surface is still the dropped-field bug), and `script` — the one
 * field two surfaces both write — must be encoded identically by both. It used to
 * be hand-built at each call site, and the API DTO dropped it silently.
 *
 * The voice panel's two fields are the SAME specs the create form uses (it POSTs
 * when the org has no script and PUTs when it has one), so the labels cannot
 * drift between the two verbs.
 */

/**
 * The directive card reaches `script` through its own control, whose label is the
 * chatbot's vocabulary rather than the voice caller's. It lives here so the card
 * and the contract's per-surface fill read the same string — the guarantee
 * `form.labels` gives every other control.
 */
export const DIRECTIVE_LABEL = 'Chatbot Instructions';

export const updateVoiceScriptForm = defineForm({
  fields: {
    voice: voiceField,
    language: languageField,

    initialMessage: {
      schema: z.string(),
      label: 'Initial Message',
      control: 'textarea',
      default: '',
      // No `{{…}}` in samples: the harness types with user-event, where `{{` is
      // the escape for a literal brace.
      sample: 'Hi there, is now a good time to talk?',
    },
    script: {
      schema: z.string(),
      label: 'AI Agent Script',
      control: 'textarea',
      default: '',
      sample: 'You are a warm clinic assistant. Book appointments.',
    },
    qualificationQuestions: {
      // A sortable list of textareas with no labelled control — driven by a
      // `fills` override that types into the empty row.
      schema: z.array(z.string()),
      label: 'Qualification Questions',
      control: 'custom',
      default: [],
      sample: ['What treatment are you interested in?'],
    },
    followUps: {
      schema: z.array(z.string()),
      label: 'Follow Ups',
      control: 'custom',
      default: [],
      sample: ['Just checking you got this!'],
    },

    name: {
      schema: z.string(),
      default: 'Default Script',
      exempt:
        "the onboarding editor always writes the org's ONE default script; it " +
        'stamps the name and never offers a control for it.',
    },
    isDefault: {
      schema: z.boolean(),
      default: true,
      exempt:
        'same — the onboarding editor only ever writes the default script.',
    },
  },
});

export const updateVoiceScriptFormSchema = updateVoiceScriptForm.schema;
export const updateVoiceScriptFormDefaults = updateVoiceScriptForm.defaults;
export const updateVoiceScriptFormFields = updateVoiceScriptForm.fields;

export type UpdateVoiceScriptFormValues = InferFormValues<
  typeof updateVoiceScriptForm
>;
