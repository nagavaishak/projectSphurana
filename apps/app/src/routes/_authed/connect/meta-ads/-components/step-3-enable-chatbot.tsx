import { Switch } from '@/components/ui/switch';
import { BotMessageSquare } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import type { MetaAdsSetupFormData } from './meta-ads-setup-form';

interface Step3EnableChatbotProps {
  form: UseFormReturn<MetaAdsSetupFormData>;
}

export function Step3EnableChatbot({ form }: Step3EnableChatbotProps) {
  const enableChatbot = form.watch('enableChatbot');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Enable AI Chatbot</h1>
        <p className="text-sm text-muted-foreground">
          Automatically respond to customer messages on your connected pages
          using your AI chatbot.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => form.setValue('enableChatbot', !enableChatbot)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            form.setValue('enableChatbot', !enableChatbot);
          }
        }}
        className={`flex cursor-pointer items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
          enableChatbot ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <BotMessageSquare className="size-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-medium">Enable chatbot for selected pages</p>
          <p className="text-sm text-muted-foreground">
            Your chatbot will automatically respond to messages received on the
            Facebook pages you selected. You can configure it later from the
            Chatbot page.
          </p>
        </div>
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Switch checked={enableChatbot} tabIndex={-1} aria-hidden />
        </div>
      </div>
    </div>
  );
}
