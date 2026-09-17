import { MOBILE_FILTER_CHROME_CLASS } from '@/features/mobile-ui/mobile-filter-chrome';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

interface MobileSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export function MobileSearchField({
  value,
  onChange,
  placeholder,
  className,
}: MobileSearchFieldProps) {
  return (
    <label
      className={cn('relative block', MOBILE_FILTER_CHROME_CLASS, className)}
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8E8E93]"
        strokeWidth={2}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[10px] bg-transparent pl-9 pr-3 text-[14px] leading-none text-black outline-none placeholder:text-[#8E8E93] focus-visible:outline-none"
      />
    </label>
  );
}
