import { Button } from '@/components/ui/button';
import { useWhatsAppEmbeddedSignup } from '../hooks/use-whatsapp-embedded-signup';

interface WhatsAppConnectButtonProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  label?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
}

/**
 * Standalone button that triggers the WhatsApp Embedded Signup popup.
 * For integrations-grid-style UI where the launch is called from a switch
 * statement, use `useWhatsAppEmbeddedSignup()` directly instead.
 */
export function WhatsAppConnectButton({
  onSuccess,
  onError,
  label = 'Connect WhatsApp',
  className,
  variant = 'default',
}: WhatsAppConnectButtonProps) {
  const { launch, isReady, isBusy } = useWhatsAppEmbeddedSignup({
    onSuccess,
    onError,
  });

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={launch}
      disabled={!isReady || isBusy}
    >
      {isBusy ? 'Connecting…' : label}
    </Button>
  );
}
