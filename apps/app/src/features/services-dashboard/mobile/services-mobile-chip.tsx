import { cn } from '@/lib/utils';

interface ServicesMobileChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function ServicesMobileChip({
  active,
  onClick,
  children,
}: ServicesMobileChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
          : 'border-[#E5E5EA] bg-white text-[#0A0A0A] active:bg-[#F2F2F7]'
      )}
    >
      {children}
    </button>
  );
}
