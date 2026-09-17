import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Haptic feedback helpers — no-op on web/desktop, fire native impulses on
 * iOS/Android via the Capacitor plugin. Errors are swallowed so a missing
 * plugin never breaks the calling flow.
 */

const isNative = () => Capacitor.isNativePlatform();

export function hapticImpact(style: ImpactStyle = ImpactStyle.Medium): void {
  if (!isNative()) return;
  void Haptics.impact({ style }).catch(() => {});
}

export function hapticSelection(): void {
  if (!isNative()) return;
  void Haptics.selectionChanged().catch(() => {});
}

export function hapticNotify(
  type: NotificationType = NotificationType.Success
): void {
  if (!isNative()) return;
  void Haptics.notification({ type }).catch(() => {});
}

export { ImpactStyle, NotificationType };
