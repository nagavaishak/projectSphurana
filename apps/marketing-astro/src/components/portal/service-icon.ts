import {
  CalendarCheckIcon,
  HandHeartIcon,
  type LucideIcon,
  ScissorsIcon,
  SmileIcon,
  SparklesIcon,
  StethoscopeIcon,
  SyringeIcon,
  ZapIcon,
} from 'lucide-react';

/**
 * Map a service name to a representative lucide icon by keyword. Purely
 * cosmetic — every service still works regardless of the icon chosen; the
 * fallback (a calendar-check) is used when nothing matches.
 */
export function serviceIcon(
  serviceName: string | null | undefined
): LucideIcon {
  const name = (serviceName ?? '').toLowerCase();

  if (/botox|inject|filler|dermal/.test(name)) return SyringeIcon;
  if (/laser/.test(name)) return ZapIcon;
  if (/facial|skin|peel|glow/.test(name)) return SparklesIcon;
  if (/hair|cut|barber/.test(name)) return ScissorsIcon;
  if (/massage|body|sculpt/.test(name)) return HandHeartIcon;
  if (/teeth|dental|whiten|smile/.test(name)) return SmileIcon;
  if (/consult|assessment|review/.test(name)) return StethoscopeIcon;

  return CalendarCheckIcon;
}
