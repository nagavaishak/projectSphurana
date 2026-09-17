import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { Loader2, PhoneCall } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VoiceScript } from '@/features/voice-scripts';

interface TestCallResponse {
  success: boolean;
  callControlId?: string;
  message: string;
}

interface TestCallCardProps {
  voiceScript: VoiceScript | null;
}

/**
 * Places a real outbound AI call to the entered number using the org's default
 * voice script as the agent. Requires a saved voice script (agentConfigId).
 */
export function TestCallCard({ voiceScript }: TestCallCardProps) {
  const [phone, setPhone] = useState('');

  const mutation = useMutation({
    mutationFn: (input: { to: string; agentConfigId: string }) =>
      apiClient.post<TestCallResponse>('sequences/test-call', input),
    onSuccess: (data) => {
      toast.success(data.message ?? 'Test call initiated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to place test call');
    },
  });

  const canCall = !!voiceScript && phone.trim().length > 0;

  const handleCall = () => {
    if (!voiceScript) return;
    mutation.mutate({ to: phone.trim(), agentConfigId: voiceScript.id });
  };

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="size-4 text-muted-foreground" />
          Test call
        </CardTitle>
        <CardDescription>
          Get a live call from your AI voice caller to hear it in action.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-call-phone">Your phone number</Label>
          <Input
            autoComplete="tel"
            id="test-call-phone"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCall && !mutation.isPending) {
                handleCall();
              }
            }}
            placeholder="+353 85 123 4567"
            type="tel"
            value={phone}
          />
        </div>

        <Button
          className="w-full"
          disabled={!canCall || mutation.isPending}
          onClick={handleCall}
        >
          {mutation.isPending ? (
            <Loader2 className="mr-1.5 size-3 animate-spin" />
          ) : (
            <PhoneCall className="mr-1.5 size-3.5" />
          )}
          Receive a test call
        </Button>

        {!voiceScript && (
          <p className="text-xs text-muted-foreground">
            Save your voice settings first to enable test calls.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
