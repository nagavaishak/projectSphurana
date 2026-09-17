import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TIME_OF_DAY_OPTIONS } from '../lib/time';

interface TimeSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Time-of-day picker in 5-minute increments (00:00 .. 23:55), per the
 * Fresha scheduling model. Value is an HH:mm string.
 */
export function TimeSelect({
  id,
  value,
  onChange,
  disabled,
  className,
  ...rest
}: TimeSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className} {...rest}>
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {TIME_OF_DAY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
