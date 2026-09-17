import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToggleInstagramChatbot } from '@/features/integrations/api';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { BotMessageSquare, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function InstagramChatbotDialog() {
  // `strict: false` — IntegrationsGrid (which renders this dialog) is reused on
  // both the Integrations and Calendar settings routes. Only the Integrations
  // route carries the `instagram` param; elsewhere it's simply absent.
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const instagramParam = search.instagram;

  useEffect(() => {
    if (instagramParam === 'connected') {
      setOpen(true);
    }
  }, [instagramParam]);

  // Enable-only onboarding prompt: its sole action enables the chatbot, so it
  // always passes `enabled: true` (the other surfaces pass a live toggle
  // value). Same builder, same wire shape.
  const { toggleInstagramChatbotAsync, isToggling } =
    useToggleInstagramChatbot();

  const handleClose = () => {
    setOpen(false);
    void navigate({
      to: '/dashboard/settings/integrations',
      search: {},
      replace: true,
    });
  };

  const handleEnable = async () => {
    try {
      await toggleInstagramChatbotAsync({ enabled: true });
      toast.success('Instagram chatbot enabled');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message || 'Failed to enable Instagram chatbot'
          : 'Failed to enable Instagram chatbot'
      );
    }
    handleClose();
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-2">
            <BotMessageSquare className="size-6 text-primary" />
          </div>
          <DialogTitle>Enable AI Chatbot</DialogTitle>
          <DialogDescription>
            Would you like to enable the AI chatbot for your Instagram account?
            It will automatically respond to customer messages.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Not now
          </Button>
          <Button onClick={handleEnable} disabled={isToggling}>
            {isToggling && <Loader2 className="mr-1.5 size-3 animate-spin" />}
            Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
