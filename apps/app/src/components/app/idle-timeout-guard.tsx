import { useIdleTimeout } from '@/hooks/use-idle-timeout';

export function IdleTimeoutGuard() {
  useIdleTimeout();
  return null;
}
