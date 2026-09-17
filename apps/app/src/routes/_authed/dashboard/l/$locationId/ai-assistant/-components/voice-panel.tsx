import { Loader2, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type VoiceScript,
  createVoiceScriptForm,
  useCreateVoiceScript,
  useUpdateVoiceScript,
} from '@/features/voice-scripts';

/**
 * Labels come from the voice-script form declaration, not from literals here —
 * the form contract locates each control by the same string.
 */
const L = createVoiceScriptForm.labels;

/**
 * Curated ElevenLabs premade voices for the AI voice caller. Values are the
 * ElevenLabs voice IDs stored on `voiceScript.agentConfig.voice`.
 */
const VOICE_OPTIONS = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — American female, calm' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — American female, soft' },
  { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte — British female, warm' },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    label: 'Jessica — American female, expressive',
  },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — American male, deep' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam — American male, articulate' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel — British male, authoritative' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George — British male, warm' },
] as const;

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
] as const;

const DEFAULT_VOICE = VOICE_OPTIONS[0].id;
const DEFAULT_LANGUAGE = 'en';

// Minimal opener used only when auto-creating a voice script for an org that
// doesn't have one yet. The full script is managed by the Directive card.
export const VOICE_PANEL_DEFAULT_INITIAL_MESSAGE =
  "Hi {{contact.first_name}}, thanks for getting in touch — I'm calling to help you book in. Is now a good time?";

interface VoicePanelProps {
  organizationId: string;
  voiceScript: VoiceScript | null;
  isLoading: boolean;
}

/**
 * Voice settings for the AI voice caller: which ElevenLabs voice speaks and the
 * spoken language. Persisted onto the org's default voice script's agentConfig.
 */
export function VoicePanel({
  organizationId,
  voiceScript,
  isLoading,
}: VoicePanelProps) {
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);

  const { updateVoiceScript, isUpdating } = useUpdateVoiceScript();
  const { createVoiceScript, isCreating } = useCreateVoiceScript();
  const isSaving = isUpdating || isCreating;

  useEffect(() => {
    if (voiceScript?.agentConfig) {
      setVoice(voiceScript.agentConfig.voice ?? DEFAULT_VOICE);
      setLanguage(voiceScript.agentConfig.language ?? DEFAULT_LANGUAGE);
    }
  }, [voiceScript]);

  const savedVoice = voiceScript?.agentConfig?.voice ?? DEFAULT_VOICE;
  const savedLanguage = voiceScript?.agentConfig?.language ?? DEFAULT_LANGUAGE;
  const hasChanges = voice !== savedVoice || language !== savedLanguage;

  const handleSave = () => {
    const agentConfig = {
      ...(voiceScript?.agentConfig ?? {}),
      voice,
      language,
    };

    if (voiceScript) {
      updateVoiceScript({ id: voiceScript.id, agentConfig });
    } else {
      createVoiceScript({
        initialMessage: VOICE_PANEL_DEFAULT_INITIAL_MESSAGE,
        agentConfig,
      });
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="size-4 text-muted-foreground" />
          Voice caller
        </CardTitle>
        <CardDescription>
          The voice and language for outbound AI calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="voice">{L.voice}</Label>
              <Select onValueChange={setVoice} value={voice}>
                <SelectTrigger className="w-full" id="voice">
                  <SelectValue placeholder="Select a voice" />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="language">{L.language}</Label>
              <Select onValueChange={setLanguage} value={language}>
                <SelectTrigger className="w-full" id="language">
                  <SelectValue placeholder="Select a language" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              disabled={isSaving || !hasChanges || !organizationId}
              onClick={handleSave}
            >
              {isSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
              Save voice
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
