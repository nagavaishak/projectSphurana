import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface AppointmentClientAvatarProps {
  name: string;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function AppointmentClientAvatar({
  name,
  className,
}: AppointmentClientAvatarProps) {
  return (
    <Avatar className={cn('size-12 shrink-0', className)}>
      <AvatarFallback className="bg-[#F2F2F7] text-sm font-medium text-[#3C3C43]">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
