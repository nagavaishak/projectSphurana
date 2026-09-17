import {
  type EditableFieldSpec,
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The voice-caller CONFIG form (voice + language), declared ONCE.
 *
 * `POST /voice-scripts` has two creators, and they are not two surfaces of one
 * form — they create the same resource from opposite ends:
 *
 *   - the ai-assistant VOICE PANEL (this form): the operator picks a voice and a
 *     language; if the org has no script yet the panel creates one, seeding the
 *     opener from a constant because the panel does not edit copy.
 *   - the onboarding STEP-3 EDITOR: auto-creates the org's default script on
 *     mount, entirely from constants, before the user has typed anything.
 *
 * Only the first is form-driven, so only the first has a declaration. The second
 * is contracted as a `noForm` operation in `create-voice-script.contract.test.tsx`.
 *
 * The same two fields are edited by the panel when a script already EXISTS (then
 * it is a `PUT`), so the specs are exported and the update form reuses them —
 * one label per control, whichever verb the panel ends up using.
 */

/** Curated ElevenLabs voice ids — the panel's `VOICE_OPTIONS` values. */
export const voiceField = {
  schema: z.string().min(1),
  label: 'Voice',
  control: 'select',
  default: '21m00Tcm4TlvDq8ikWAM',
  sample: 'EXAVITQu4vr4xnSDxMaL',
  sampleLabel: 'Bella — American female, soft',
  // Folded into the nested `agentConfig` object on the wire.
  derived: true,
} as const satisfies EditableFieldSpec;

export const languageField = {
  schema: z.string().min(1),
  label: 'Language',
  control: 'select',
  default: 'en',
  sample: 'es',
  sampleLabel: 'Spanish',
  derived: true,
} as const satisfies EditableFieldSpec;

export const createVoiceScriptForm = defineForm({
  fields: {
    voice: voiceField,
    language: languageField,
    initialMessage: {
      schema: z.string(),
      default: '',
      exempt:
        'the voice panel does not edit the caller opener — it seeds a fixed one ' +
        "when it has to create the org's first script. The opener itself is edited " +
        'in the onboarding step-3 editor, and the agent script in the directive card.',
    },
  },
});

export const createVoiceScriptFormSchema = createVoiceScriptForm.schema;
export const createVoiceScriptFormDefaults = createVoiceScriptForm.defaults;
export const createVoiceScriptFormFields = createVoiceScriptForm.fields;

export type CreateVoiceScriptFormValues = InferFormValues<
  typeof createVoiceScriptForm
>;
