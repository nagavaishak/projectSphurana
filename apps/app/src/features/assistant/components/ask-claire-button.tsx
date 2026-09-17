import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  type ClairePrefillEntityType,
  buildClairePrefillSearch,
} from '../lib/build-claire-prefill-url';

export interface AskClaireButtonProps {
  prompt: string;
  entityType?: ClairePrefillEntityType;
  entityId?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm';
  children?: React.ReactNode;
  className?: string;
}

export function AskClaireButton({
  prompt,
  entityType,
  entityId,
  variant = 'outline',
  size = 'sm',
  children = 'Ask Claire',
  className,
}: AskClaireButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    const search = buildClairePrefillSearch(prompt, { entityType, entityId });
    navigate({ to: '/assistant', search });
  };

  const ariaLabel = entityType
    ? `Ask Claire about this ${entityType}`
    : 'Ask Claire';

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      aria-label={ariaLabel}
      className={cn(className)}
    >
      <Sparkles aria-hidden="true" />
      {children}
    </Button>
  );
}
