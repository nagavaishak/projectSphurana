import Link from 'next/link';
import { Button } from './ui/button';

/** Single source of truth for the demo-booking link, reused by every CTA. */
export const CAL_URL = 'https://cal.com/senan-ryan-lx3x8d/30min';

export const BookDemoButton = ({
  size,
  className,
  label = 'Book a Demo',
}: {
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  label?: string;
}) => {
  return (
    <Button variant="brand" size={size} className={className} asChild>
      <Link href={CAL_URL} target="_blank" rel="noopener noreferrer">
        {label}
      </Link>
    </Button>
  );
};
